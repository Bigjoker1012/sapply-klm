/**
 * ЕДИНЫЙ источник расчёта статуса планирования закупок.
 *
 * Один и тот же расчёт используют:
 *   - страница «Планирование закупок» (GET /api/planning)
 *   - светофор на «Главной» (GET /api/dashboard/*)
 * чтобы статусы НИКОГДА не расходились между экранами.
 *
 * Формула (как на странице «Планирование»):
 *   qty_today  = остаток Полоцк + Липковская + в пути − потребность по рецептам
 *                (в списывающих статусах), но не ниже 0.
 *   need_ratio = qty_today / среднемес. расход (только ручной ввод; иначе статус не считаем)
 *   final      = need_ratio / ручной коэф-т (запас под срок поставки, 1.0–2.0)
 *   статус:  final > 1.5 → ok; > 1.0 → control; ≥ 0.6 → buy; иначе → urgent.
 * Без введённого среднемес. расхода статус = "none" (позиция без статуса — не
 * попадает в карточки светофора).
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
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
  qty_today: number;
  /** Среднемес. расход: число при ручном вводе, иначе null (авто пока нет). */
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
  /** Коэф-т потребности = qty_today / расход (null без расхода). */
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
 * Статус по qty_today / расходу / коэф-ту. Тот же расчёт, что analyze() в
 * client/src/pages/Planning.tsx — держим единым, чтобы не расходились.
 */
export function planningStatusOf(
  qty_today: number,
  avg: number | null,
  coefficient: number,
): { status: PlanningStatus; need_ratio: number | null; final: number | null } {
  if (avg === null || !(avg > 0)) return { status: "none", need_ratio: null, final: null };
  const need_ratio = qty_today / avg;
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
    db.execute(sql`SELECT sku_code, coefficient, manual_input, manual_avg_usage FROM purchase_plan_setting`),
  ]);

  const settings = new Map<string, { coefficient: number; manual_input: boolean; manual_avg_usage: number | null }>();
  for (const r of settingRes.rows as Array<{ sku_code: string; coefficient: number | null; manual_input: boolean | null; manual_avg_usage: number | null }>) {
    settings.set(String(r.sku_code), {
      coefficient: normCoefficient(r.coefficient),
      manual_input: r.manual_input === true,
      manual_avg_usage: r.manual_avg_usage ?? null,
    });
  }

  return catalog
    .filter(m => m.active)
    .map(m => {
      const s = settings.get(m.raw_uid);
      const manual_input = s?.manual_input ?? false;
      const manual_avg_usage = s?.manual_avg_usage ?? null;
      const coefficient = s?.coefficient ?? 1;
      const plant_qty = round2(plant.get(m.raw_uid) || 0);
      const lip_qty = round2(lip.get(m.raw_uid) || 0);
      const inbound_qty = round2(inbound.get(m.raw_uid) || 0);
      const planned_need = round2(need.get(m.raw_uid) || 0);
      // Остаток на руках за вычетом потребности по рецептам, не ниже 0.
      const qty_today = Math.max(0, round2(plant_qty + lip_qty + inbound_qty - planned_need));
      const avg = manual_input ? manual_avg_usage : null;
      const { status, need_ratio, final } = planningStatusOf(qty_today, avg, coefficient);
      return {
        raw_uid: m.raw_uid,
        name: m.full_name,
        unit: m.unit,
        plant_qty,
        lip_qty,
        inbound_qty,
        planned_need,
        qty_today,
        avg_monthly_usage: avg,
        coefficient,
        manual_input,
        manual_avg_usage,
        need_ratio,
        final,
        status,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
