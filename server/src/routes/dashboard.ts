/**
 * Дашборд снабжения. Эндпоинты:
 *   GET /api/dashboard/all        — всё для главного экрана за один запрос
 *   GET /api/dashboard/decisions  — только решения по закупкам
 *   GET /api/dashboard/status     — короткий статус-блок
 *   GET /api/dashboard/export     — выгрузка решений в XLSX
 *
 * Источник данных по остаткам и решениям о закупках — Google Sheets (тот же,
 * что и страница «Планирование закупок»): Полоцк + Липковская + в пути − рецепты.
 * Справочник, очередь распознавания и архив документов берём из PostgreSQL.
 *
 * Форма ответа сохранена под текущий фронт client/src/pages/Dashboard.tsx.
 *
 * Доступ только для авторизованных: requireAuth навешан на весь роутер.
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/client";
import { requireAuth } from "../auth/middleware";
import {
  getInboundList,
} from "../services/sheetsService";
import { computePlanningRows, PlanningStatus } from "../services/planningStatus";

const router = Router();

router.use(requireAuth);

// ──────────────────────────────────────────────────────────────────────────────
// Типы
// ──────────────────────────────────────────────────────────────────────────────

interface Decision {
  raw_uid: string;
  name: string;
  avg_monthly_usage: number;
  threshold_qty: number;
  plant_qty: number;
  lip_qty: number;
  inbound_qty: number;
  planned_need: number;
  available_total: number;
  expected_after_plan: number;
  status: "Срочно к закупке" | "К закупке" | "На контроле" | "Норма" | "Не задан";
  cover_by_transfer: number;
  cover_by_purchase: number;
}

/** Статус планирования → подпись светофора на «Главной». */
const PLANNING_STATUS_RU: Record<PlanningStatus, Decision["status"]> = {
  urgent: "Срочно к закупке",
  buy: "К закупке",
  control: "На контроле",
  ok: "Норма",
  none: "Не задан",
};

interface RawMaterialDto {
  raw_uid: string;
  full_name: string;
  short_name: string;
  unit: string;
  avg_monthly_usage: number;
  reorder_threshold_factor: number;
  lead_time_days: number;
  active: boolean;
}

/**
 * Форма ровно та, что ждёт InboundItem на фронте (Dashboard.tsx):
 *   { id, raw_uid, raw_name, qty, eta, destination, status }
 * id — строка (legacy-контракт), destination — имя склада-назначения.
 */
interface InboundDto {
  id: string;
  raw_uid: string;
  raw_name: string;
  qty: number;
  eta: string;
  destination: string;
  status: string;
}

/**
 * Форма ровно та, что ждёт UnmatchedItem на фронте:
 *   { id, original_text, source_type, file_name }
 */
interface UnmatchedDto {
  id: string;
  original_text: string;
  source_type: string;
  file_name: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Запросы к БД
// ──────────────────────────────────────────────────────────────────────────────

/** Полный список сырья для блока «справочник». */
async function loadRawMaterials(): Promise<RawMaterialDto[]> {
  const rows = (await db.execute(sql`
    SELECT
      s.code     AS raw_uid,
      s.name     AS full_name,
      s.name     AS short_name,
      s.unit     AS unit,
      COALESCE(s.reorder_point_kg, 0) AS reorder_point_kg,
      s.active   AS active
    FROM sku s
    ORDER BY s.name
  `)).rows as Array<{
    raw_uid: string; full_name: string; short_name: string; unit: string;
    reorder_point_kg: number; active: boolean;
  }>;
  return rows.map(r => ({
    raw_uid: r.raw_uid,
    full_name: r.full_name,
    short_name: r.short_name,
    unit: r.unit,
    // avg_monthly_usage пока не считаем — нужна история производства.
    avg_monthly_usage: 0,
    // Сохраняем форму фронта: коэффициент 0.5, дни 30 — дефолты.
    reorder_threshold_factor: 0.5,
    lead_time_days: 30,
    active: r.active === true,
  }));
}

/**
 * Список «в пути» — для блока на дашборде. Источник — лист Inbound в Google
 * Sheets (как и расчёты getInboundTotals и ручной ввод через /api/in-transit),
 * а НЕ пустая Postgres-таблица in_transit. getInboundList уже прячет строки со
 * статусом «получено»/«удалено», поэтому удалённые позиции исчезают из списка.
 */
async function loadInbound(): Promise<InboundDto[]> {
  const list = await getInboundList();
  return list.map(r => ({
    id: String(r.id),
    raw_uid: r.raw_uid,
    raw_name: r.raw_name,
    qty: Math.round((r.qty + Number.EPSILON) * 100) / 100,
    eta: r.eta ?? "",
    destination: r.destination ?? "",
    status: r.status,
  }));
}

/**
 * Строки загрузок, ждущие ручного review (раньше — лист ReviewQueue в Sheets).
 *
 * Имя в JSON ищем по типичным ключам Excel-строки. Это эвристика: реальный
 * парсер /api/upload ещё не переписан на новую схему — пока подложит сюда то,
 * что положит. Кнопка «подтвердить» на фронте идёт в /api/upload/unmatched/confirm,
 * который тоже ещё на старом sheetsService — поэтому подтверждение не сработает,
 * пока upload-роут не переписан. На пустой БД ничего не отдаём — фронт не упадёт.
 */
async function loadUnmatched(): Promise<UnmatchedDto[]> {
  const rows = (await db.execute(sql`
    SELECT
      ur.id        AS id,
      COALESCE(
        ur.raw_payload->>'name',
        ur.raw_payload->>'full_name',
        ur.raw_payload->>'raw_name',
        ''
      )            AS original_text,
      uj.kind      AS source_type,
      uj.filename  AS file_name
    FROM upload_row ur
    JOIN upload_job uj ON uj.id = ur.upload_job_id
    WHERE ur.action = 'manual_review' AND uj.status = 'review'
    ORDER BY ur.id DESC
    LIMIT 200
  `)).rows as Array<{ id: number; original_text: string; source_type: string; file_name: string }>;
  return rows.map(r => ({
    id: String(r.id),
    original_text: r.original_text,
    source_type: r.source_type,
    file_name: r.file_name,
  }));
}

/** Короткий статус-блок (последнее обновление, in-transit, review-очередь). */
async function loadStatus() {
  const lastPlantRow = (await db.execute(sql`
    SELECT MAX(ss.created_at) AS last_update
    FROM stock_snapshot ss
    JOIN warehouse w ON w.id = ss.warehouse_id
    WHERE w.code = 'POLOTSK'
  `)).rows[0] as { last_update: string | null } | undefined;

  // Счётчик «в пути» берём из того же источника, что и список (Sheets Inbound),
  // иначе нижняя панель показывала бы 0 при непустом списке выше.
  const inboundList = await getInboundList();

  const unresolvedRow = (await db.execute(sql`
    SELECT COUNT(*) AS c FROM upload_row ur
    JOIN upload_job uj ON uj.id = ur.upload_job_id
    WHERE ur.action = 'manual_review' AND uj.status = 'review'
  `)).rows[0] as { c: number | string };

  return {
    plant_last_update: lastPlantRow?.last_update ?? null,
    active_inbound_count: inboundList.length,
    unresolved_review_count: Number(unresolvedRow.c),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Бизнес-логика: решения о закупках
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<Decision["status"], number> = {
  "Срочно к закупке": 0,
  "К закупке": 1,
  "На контроле": 2,
  "Норма": 3,
  "Не задан": 5,
};

/**
 * Светофор «Главной» = статусы из «Планирования закупок» (единый расчёт
 * services/planningStatus.ts): статус берём по ручному среднемес. расходу и
 * коэф-ту, а НЕ по потребности рецептов. Где расход не задан — статус «Не задан»
 * (позиция без светофора, в карточки не попадает). Так главная и «Планирование»
 * всегда показывают один и тот же статус.
 */
async function computeDecisions(): Promise<Decision[]> {
  const rows = await computePlanningRows();

  const decisions: Decision[] = rows.map(r => {
    const on_hand = r.plant_qty + r.lip_qty + r.inbound_qty;   // остаток + в пути
    const need = r.planned_need;                               // потребность рецептов
    const available_total = on_hand;
    const expected_after_plan = on_hand - need;                // может быть < 0 (для таблицы)

    // Потребность закрываем сначала запасом самого Полоцка (+ его приход),
    // затем перебросом с Липковской, и лишь остаток — закупкой.
    const polotsk_side = r.plant_qty + r.inbound_qty;
    const polotsk_deficit = Math.max(0, need - polotsk_side);
    const cover_by_transfer = Math.min(r.lip_qty, polotsk_deficit);
    const cover_by_purchase = Math.max(0, need - on_hand);

    return {
      raw_uid: r.raw_uid,
      name: r.name,
      // Светофор завязан на ручной среднемес. расход — показываем его в таблице.
      avg_monthly_usage: r.avg_monthly_usage ?? 0,
      threshold_qty: 0,
      plant_qty: r.plant_qty,
      lip_qty: r.lip_qty,
      inbound_qty: r.inbound_qty,
      planned_need: r.planned_need,
      available_total,
      expected_after_plan,
      status: PLANNING_STATUS_RU[r.status],
      cover_by_transfer,
      cover_by_purchase,
    };
  });

  decisions.sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4));
  return decisions;
}

// ──────────────────────────────────────────────────────────────────────────────
// Роуты
// ──────────────────────────────────────────────────────────────────────────────

router.get("/all", async (_req: Request, res: Response) => {
  try {
    const [decisions, rawMaterials, inbound, unmatched, status] = await Promise.all([
      computeDecisions(),
      loadRawMaterials(),
      loadInbound(),
      loadUnmatched(),
      loadStatus(),
    ]);
    res.json({ decisions, rawMaterials, inbound, unmatched, status });
  } catch (err: any) {
    console.error("[dashboard/all]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/decisions", async (_req: Request, res: Response) => {
  try {
    res.json(await computeDecisions());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json(await loadStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const decisions = await computeDecisions();
    const rows = decisions.map(d => ({
      "Код сырья": d.raw_uid,
      "Наименование": d.name,
      "Ср. расход кг/мес": d.avg_monthly_usage,
      "Порог закупки кг": d.threshold_qty,
      "Полоцк кг": d.plant_qty,
      "Липковская кг": d.lip_qty,
      "В пути кг": d.inbound_qty,
      "Потребность кг": d.planned_need,
      "Доступно кг": d.available_total,
      "Ост. после плана кг": d.expected_after_plan,
      "Статус": d.status,
      "Переброска с Липковской кг": d.cover_by_transfer,
      "Закупить кг": d.cover_by_purchase,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Решения");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="decisions_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
