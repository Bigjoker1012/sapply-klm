import { sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  getAllRawMaterials,
  getLatestPlantStock,
  getLatestLipStock,
  getInboundTotals,
  getNeedTotals,
} from "./readSwitch";
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
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
  need_ratio: number | null;
  final: number | null;
  status: PlanningStatus;
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function normCoefficient(c: number | null | undefined): number {
  return Math.min(2, Math.max(1, Number(c ?? 1) || 1));
}

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

export async function computePlanningRows(): Promise<PlanningComputedRow[]> {
  const [catalog, plant, lip, inbound, need, settingRes, activeSkus] = await Promise.all([
    getAllRawMaterials(),
    getLatestPlantStock(),
    getLatestLipStock(),
    getInboundTotals(),
    getNeedTotals(),
    db.execute(sql`SELECT sku_code, coefficient, manual_input, manual_avg_usage FROM purchase_plan_setting`),
    db.execute(sql`SELECT DISTINCT s.code FROM recipe_item ri JOIN recipe r ON ri.recipe_id = r.id JOIN sku s ON ri.sku_id = s.id WHERE r.status = 'active'`),
  ]);

  const activeSkuSet = new Set<string>();
  for (const r of activeSkus.rows as Array<{ code: string }>) {
    activeSkuSet.add(String(r.code));
  }

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
      const qty_today = Math.max(0, round2(plant_qty + lip_qty));
      // Only use avg if the SKU is in at least one active recipe
      const avg = activeSkuSet.has(m.raw_uid) ? manual_avg_usage : null;
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
        avg_monthly_usage: manual_avg_usage,
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
