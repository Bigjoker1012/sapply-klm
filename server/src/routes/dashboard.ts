/**
 * Дашборд снабжения. Эндпоинты:
 *   GET /api/dashboard/all        — всё для главного экрана за один запрос
 *   GET /api/dashboard/decisions  — только решения по закупкам
 *   GET /api/dashboard/status     — короткий статус-блок
 *   GET /api/dashboard/export     — выгрузка решений в XLSX
 *
 * Источник данных: новая PostgreSQL-схема (см. server/src/db/schema.ts).
 * Раньше — Google Sheets через sheetsService.ts (этот файл уже не импортируем).
 *
 * Форма ответа сохранена под текущий фронт client/src/pages/Dashboard.tsx.
 *
 * TODO: добавить requireAuth, когда фронт начнёт слать Bearer-токен.
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/client";

const router = Router();

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
  status: "Срочно к закупке" | "К закупке" | "На контроле" | "Норма";
  cover_by_transfer: number;
  cover_by_purchase: number;
}

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

/** Активные SKU + остатки по двум складам + ETA-приход + плановая потребность. */
async function loadAggregates() {
  /**
   * Один большой read-only join: каждая активная SKU + SUM остатков по
   * POLOTSK/LIPKOV (только активные партии) + сумма in_transit (не received)
   * + плановая потребность (production_plan planned/in_progress * recipe_item).
   */
  const rows = (await db.execute(sql`
    SELECT
      s.id                                      AS sku_id,
      s.code                                    AS raw_uid,
      s.name                                    AS name,
      s.unit                                    AS unit,
      COALESCE(s.reorder_point_kg, 0)           AS threshold_qty,
      COALESCE(s.min_stock_kg, 0)               AS min_stock_kg,
      COALESCE((
        SELECT SUM(b.current_qty_kg) FROM batch b
        JOIN warehouse w ON w.id = b.warehouse_id
        WHERE b.sku_id = s.id AND b.status = 'active' AND w.code = 'POLOTSK'
      ), 0)                                     AS plant_qty,
      COALESCE((
        SELECT SUM(b.current_qty_kg) FROM batch b
        JOIN warehouse w ON w.id = b.warehouse_id
        WHERE b.sku_id = s.id AND b.status = 'active' AND w.code = 'LIPKOV'
      ), 0)                                     AS lip_qty,
      COALESCE((
        SELECT SUM(it.qty_kg) FROM in_transit it
        WHERE it.sku_id = s.id AND it.status IN ('at_supplier','in_transit','customs')
      ), 0)                                     AS inbound_qty,
      COALESCE((
        SELECT SUM(pp.qty_t * ri.dose_kg_per_t) FROM production_plan pp
        JOIN recipe_item ri ON ri.recipe_id = pp.recipe_id
        WHERE ri.sku_id = s.id AND pp.status IN ('planned','in_progress')
      ), 0)                                     AS planned_need
    FROM sku s
    WHERE s.active = true
    ORDER BY s.name
  `)).rows as Array<{
    sku_id: number; raw_uid: string; name: string; unit: string;
    threshold_qty: number; min_stock_kg: number;
    plant_qty: number; lip_qty: number; inbound_qty: number; planned_need: number;
  }>;
  return rows;
}

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

/** Список «в пути» — для нижнего блока на дашборде. */
async function loadInbound(): Promise<InboundDto[]> {
  const rows = (await db.execute(sql`
    SELECT
      it.id          AS id,
      s.code         AS raw_uid,
      s.name         AS raw_name,
      it.qty_kg      AS qty,
      it.eta_date    AS eta,
      w.name         AS destination,
      it.status      AS status
    FROM in_transit it
    JOIN sku s ON s.id = it.sku_id
    JOIN warehouse w ON w.id = it.warehouse_id
    WHERE it.status IN ('at_supplier','in_transit','customs')
    ORDER BY COALESCE(it.eta_date, '9999-12-31'), it.id
  `)).rows as Array<{
    id: number; raw_uid: string; raw_name: string; qty: number;
    eta: string | null; destination: string; status: string;
  }>;
  return rows.map(r => ({
    id: String(r.id),
    raw_uid: r.raw_uid,
    raw_name: r.raw_name,
    qty: r.qty,
    eta: r.eta ?? "",
    destination: r.destination,
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

  const activeInboundRow = (await db.execute(sql`
    SELECT COUNT(*) AS c FROM in_transit
    WHERE status IN ('at_supplier','in_transit','customs')
  `)).rows[0] as { c: number | string };

  const unresolvedRow = (await db.execute(sql`
    SELECT COUNT(*) AS c FROM upload_row ur
    JOIN upload_job uj ON uj.id = ur.upload_job_id
    WHERE ur.action = 'manual_review' AND uj.status = 'review'
  `)).rows[0] as { c: number | string };

  return {
    plant_last_update: lastPlantRow?.last_update ?? null,
    active_inbound_count: Number(activeInboundRow.c),
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
};

async function computeDecisions(): Promise<Decision[]> {
  const aggregates = await loadAggregates();

  const decisions: Decision[] = aggregates.map(a => {
    const threshold = a.threshold_qty;            // точка перезаказа (кг)
    const minStock = a.min_stock_kg;              // страховой запас (кг)
    const available_total = a.plant_qty + a.lip_qty + a.inbound_qty;
    const expected_after_plan = available_total - a.planned_need;
    const deficit_to_threshold = Math.max(0, threshold - expected_after_plan);
    const cover_by_transfer = Math.min(a.lip_qty, deficit_to_threshold);
    const cover_by_purchase = Math.max(0, deficit_to_threshold - cover_by_transfer);

    /**
     * Статус:
     *   < 0                — Срочно к закупке (уйдём в минус)
     *   < minStock         — Срочно к закупке (пробили страховой)
     *   < threshold        — К закупке (ниже точки перезаказа)
     *   < threshold * 1.2  — На контроле (близко к перезаказу)
     *   иначе              — Норма
     */
    let status: Decision["status"] = "Норма";
    if (expected_after_plan < 0 || expected_after_plan < minStock) status = "Срочно к закупке";
    else if (expected_after_plan < threshold) status = "К закупке";
    else if (threshold > 0 && expected_after_plan < threshold * 1.2) status = "На контроле";

    return {
      raw_uid: a.raw_uid,
      name: a.name,
      avg_monthly_usage: 0, // см. TODO в loadRawMaterials
      threshold_qty: threshold,
      plant_qty: a.plant_qty,
      lip_qty: a.lip_qty,
      inbound_qty: a.inbound_qty,
      planned_need: a.planned_need,
      available_total,
      expected_after_plan,
      status,
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
