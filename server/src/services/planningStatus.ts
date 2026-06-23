/**
 * ЕДИНЫЙ источник расчёта статуса планирования закупок.
 *
 * Один и тот же расчёт используют:
 *   - страница «Планирование закупок» (GET /api/planning)
 *   - светофор на «Главной» (GET /api/dashboard/*)
 * чтобы статусы НИКОГДА не расходились между экранами.
 *
 * Формула (как на странице «Планирование»):
 *   qty_today  = остаток Полоцк + Липковская + в пути (реальный остаток).
 *   deficit    = qty_today − потребность по рецептам (может быть отрицательным).
 *   need_ratio = deficit / среднемес. расход (только ручной ввод; иначе статус не считаем)
 *   final      = need_ratio / ручной коэф-т (запас под срок поставки, 1.0–2.0)
 *   статус:  final > 1.5 → ok; > 1.0 → control; ≥ 0.6 → buy; иначе → urgent.
 * Без введённого среднемес. расхода статус = "none" (позиция без статуса — не
 * попадает в карточки светофора).
 */
import { db, pool } from "../db/client";
import {
  getAllRawMaterials,
  getLatestPlantStock,
  getLatestLipStock,
  getInboundTotals,
  getNeedTotals,
} from "./sheetsService";

export type PlanningStatus = "ok" | "control" | "buy" | "urgent" | "none";

export interface PlanningComputedRow {
  raw_uid: string;
  name: string;
  unit: string;
  plant_qty: number;
  lip_qty: number;
  inbound_qty: number;
  planned_need: number;
  /** Реальный остаток (без вычитания потребности). */
  qty_today: number;
  /** Дефицит = остаток за вычетом потребности (может быть < 0). */
  deficit: number;
  /** Среднемес. расход: ручной ввод ИЛИ авто (приоритет у ручного). */
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
  /** Авто-среднемесячный расход (последние 3 месяца). */
  auto_avg_usage: number | null;
  /** Коэф-т потребности = дефицит / расход (null без расхода). */
  need_ratio: number | null;
  /** Итог = need_ratio / коэф-т (null без расхода). */
  final: number | null;
  status: PlanningStatus;
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Нормализация ручного коэф-та: 1.0–2.0, по умолчанию 1. */
export function normCoefficient(c: number | null | undefined): number {
  return Math.min(2, Math.max(1, Number(c ?? 1) || 1));
}

/**
 * Статус по дефициту / расходу / коэф-ту. Тот же расчёт, что analyze() в
 * client/src/pages/Planning.tsx — держим единым, чтобы не расходились.
 *
 * @param deficit Дефицит = остаток за вычетом потребности (может быть < 0).
 */
export function planningStatusOf(
  deficit: number,
  avg: number | null,
  coefficient: number,
): { status: PlanningStatus; need_ratio: number | null; final: number | null } {
  if (avg === null || !(avg > 0)) return { status: "none", need_ratio: null, final: null };
  const need_ratio = deficit / avg;
  const final = need_ratio / (normCoefficient(coefficient) || 1);
  let status: PlanningStatus;
  if (final > 1.5) status = "ok";
  else if (final > 1.0) status = "control";
  else if (final >= 0.6) status = "buy";
  else status = "urgent";
  return { status, need_ratio, final };
}

/**
 * Считает строки планирования по всему активному каталогу. Источник остатков и
 * потребности — Google Sheets (тот же, что у страницы «Планирование»), настройки
 * (коэф-т / ручной ввод / расход) — Postgres (purchase_plan_setting).
 */
export async function computePlanningRows(): Promise<PlanningComputedRow[]> {
  const [catalog, plant, lip, inbound, need, settingRes] = await Promise.all([
    getAllRawMaterials(),
    getLatestPlantStock(),
    getLatestLipStock(),
    getInboundTotals(),
    getNeedTotals(),
    pool.query("SELECT sku_code, coefficient, manual_input, manual_avg_usage FROM purchase_plan_setting"),
  ]);

  const settings = new Map<string, { coefficient: number; manual_input: boolean; manual_avg_usage: number | null }>();
  for (const r of settingRes.rows as Array<{ sku_code: string; coefficient: number | null; manual_input: boolean | null; manual_avg_usage: number | null }>) {
    settings.set(String(r.sku_code), {
      coefficient: normCoefficient(r.coefficient),
      manual_input: r.manual_input === true,
      manual_avg_usage: r.manual_avg_usage ?? null,
    });
  }

  // Авто-среднемесячный расход: сумма по recipe_consumption за последние 3 месяца / 3.
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().split("T")[0];
  // Используем pool.query (нативный pg) вместо db.execute с теггированным sql литералом,
  // так как db.execute в некоторых версиях drizzle-orm может возвращать пустой массив при особых запросах.
  const autoQueryResult = await pool.query(
    "SELECT raw_uid, SUM(consumption_kg) AS total, COUNT(*) AS cnt FROM recipe_consumption WHERE completed_at >= $1 GROUP BY raw_uid",
    [cutoff]
  );
  const autoRows = autoQueryResult.rows as Array<{ raw_uid: string; total: number; cnt: number }>;
  const autoAvg = new Map<string, number>();
  for (const r of autoRows) {
    autoAvg.set(String(r.raw_uid), round2(Number(r.total) / 3));
  }

  const catalogUids = new Set(catalog.map(m => m.raw_uid));

  // Фантомы — UID, которые есть в остатках/потребности, но не в каталоге.
  const allStockUids = new Set<string>();
  for (const uid of plant.keys()) allStockUids.add(uid);
  for (const uid of lip.keys()) allStockUids.add(uid);
  for (const uid of inbound.keys()) allStockUids.add(uid);
  for (const uid of need.keys()) allStockUids.add(uid);
  const phantomUids = [...allStockUids].filter(uid => !catalogUids.has(uid));

  const rows = catalog
    .filter(m => m.active)
    .map(m => {
      const s = settings.get(m.raw_uid);
      const manual_input = s?.manual_input ?? false;
      const manual_avg_usage = s?.manual_avg_usage ?? null;
      // В автоматическом режиме коэффициент всегда 1.0 (без ручного запаса).
      const coefficient = manual_input ? (s?.coefficient ?? 1) : 1;
      const plant_qty = round2(plant.get(m.raw_uid) || 0);
      const lip_qty = round2(lip.get(m.raw_uid) || 0);
      const inbound_qty = round2(inbound.get(m.raw_uid) || 0);
      const planned_need = round2(need.get(m.raw_uid) || 0);
      const qty_today = round2(plant_qty + lip_qty + inbound_qty);
      const deficit = round2(qty_today - planned_need);
      const auto_avg_usage = autoAvg.get(m.raw_uid) ?? null;
      // Расход для статуса: ручной только при включённом флаге, иначе авто.
      const avg = manual_input ? manual_avg_usage : auto_avg_usage;
      const { status, need_ratio, final } = planningStatusOf(deficit, avg, coefficient);
      return {
        raw_uid: m.raw_uid,
        name: m.full_name,
        unit: m.unit,
        plant_qty,
        lip_qty,
        inbound_qty,
        planned_need,
        qty_today,
        deficit,
        avg_monthly_usage: avg,
        coefficient,
        manual_input,
        manual_avg_usage,
        auto_avg_usage,
        need_ratio,
        final,
        status,
      };
    });

  // Фантомы — без имени, без статуса, чтобы видно в таблице и можно было перепривязать.
  const phantomRows: PlanningComputedRow[] = phantomUids.map(uid => {
    const plant_qty = round2(plant.get(uid) || 0);
    const lip_qty = round2(lip.get(uid) || 0);
    const inbound_qty = round2(inbound.get(uid) || 0);
    const planned_need = round2(need.get(uid) || 0);
    const qty_today = round2(plant_qty + lip_qty + inbound_qty);
    const deficit = round2(qty_today - planned_need);
    return {
      raw_uid: uid,
      name: "⚠ Фантом",
      unit: "кг",
      plant_qty,
      lip_qty,
      inbound_qty,
      planned_need,
      qty_today,
      deficit,
      avg_monthly_usage: null,
      coefficient: 1,
      manual_input: false,
      manual_avg_usage: null,
      auto_avg_usage: null,
      need_ratio: null,
      final: null,
      status: "none" as PlanningStatus,
    };
  });

  return [...rows, ...phantomRows].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
