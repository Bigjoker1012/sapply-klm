/**
 * TZ 3.5 — PostgreSQL Read Layer for Supply KLM
 */

import { db } from "../db/client";
import { sql } from "drizzle-orm";

// ============================================================================
// SKU / Справочник сырья
// ============================================================================

export async function getAllRawMaterials() {
  const result = await db.execute(sql`SELECT code, name, unit, active FROM sku`);
  return result.rows.map((r: any) => ({
    raw_uid: r.code,
    full_name: r.name,
    short_name: "",
    unit: r.unit || "кг",
    avg_monthly_usage: 0,
    reorder_threshold_factor: 0.5,
    lead_time_days: 30,
    active: r.active,
  }));
}

// ============================================================================
// Stock / Остатки
// ============================================================================

function sumLatestSnapshot(rows: any[][], qtyOf: (r: any[]) => number): Map<string, number> {
  let maxDate = "";
  for (const r of rows) {
    const d = String(r[0] || "").trim();
    if (d > maxDate) maxDate = d;
  }
  const map = new Map<string, number>();
  if (!maxDate) return map;
  for (const r of rows) {
    const d = String(r[0] || "").trim();
    if (d !== maxDate) continue;
    if (!r[1]) continue;
    const uid = String(r[1]);
    map.set(uid, (map.get(uid) || 0) + qtyOf(r));
  }
  return map;
}

export async function getLatestPlantStock(): Promise<Map<string, number>> {
  const polotskId = 1;
  const result = await db.execute(sql`SELECT payload_json FROM stock_snapshot WHERE warehouse_id = ${polotskId} ORDER BY snapshot_date DESC LIMIT 1`);
  if (result.rows.length > 0) {
    const payload = result.rows[0].payload_json as any[];
    const map = new Map<string, number>();
    for (const item of payload) {
      if (item.sku_id && item.qty_kg) {
        const skuId = Number(item.sku_id);
        const skuResult = await db.execute(sql`SELECT code FROM sku WHERE id = ${skuId}`) as any;
        if (skuResult.rows.length > 0) {
          map.set(skuResult.rows[0].code, item.qty_kg);
        }
      }
    }
    return map;
  }
  return new Map();
}

export async function getLatestLipStock(): Promise<Map<string, number>> {
  const lipkovskayaId = 2;
  const result = await db.execute(sql`SELECT payload_json FROM stock_snapshot WHERE warehouse_id = ${lipkovskayaId} ORDER BY snapshot_date DESC LIMIT 1`);
  if (result.rows.length > 0) {
    const payload = result.rows[0].payload_json as any[];
    const map = new Map<string, number>();
    for (const item of payload) {
      if (item.sku_id && item.qty_kg) {
        const skuId = Number(item.sku_id);
        const skuResult = await db.execute(sql`SELECT code FROM sku WHERE id = ${skuId}`) as any;
        if (skuResult.rows.length > 0) {
          map.set(skuResult.rows[0].code, item.qty_kg);
        }
      }
    }
    return map;
  }
  return new Map();
}

// ============================================================================
// Recipes / Рецепты
// ============================================================================

export async function getRecipesList() {
  const result = await db.execute(sql`SELECT id, recipe_uid, code, name, status, batch_t, base_batch_kg, active_from FROM recipe`);
  return result.rows.filter((r: any) => r.recipe_uid).map((r: any) => ({
    recipe_uid: r.recipe_uid || "",
    code: r.code || "",
    full_name: r.name || "",
    premix_name: r.name || "",
    date: r.active_from || "",
    batch_t: r.batch_t || 0,
    customer: "",
    status: r.status || "",
    file_name: "",
    base_batch_kg: r.base_batch_kg || 1000,
  }));
}

export async function getRecipeLines(recipe_uid: string) {
  const recipeRows = await db.execute(sql`SELECT id FROM recipe WHERE recipe_uid = ${recipe_uid}`);
  if (recipeRows.rows.length === 0) return [];
  const recipeId = (recipeRows.rows[0] as any).id;
  
  const itemRows = await db.execute(sql`SELECT sku_id, dose_kg_per_t, norm_g_per_t, consumption_kg, match_status FROM recipe_item WHERE recipe_id = ${recipeId}`);
  
  const results = [];
  for (const item of itemRows.rows) {
    const skuResult = await db.execute(sql`SELECT code FROM sku WHERE id = ${(item as any).sku_id}`) as any;
    const skuCode = skuResult.rows.length > 0 ? skuResult.rows[0].code : "";
    results.push({
      recipe_uid,
      raw_uid: skuCode,
      name_from_recipe: "",
      input_pct: (item as any).dose_kg_per_t || 0,
      norm_g_per_t: (item as any).norm_g_per_t || 0,
      consumption_kg: (item as any).consumption_kg || 0,
      match_status: (item as any).match_status || "",
    });
  }
  return results;
}

// ============================================================================
// Need / Потребность
// ============================================================================

export async function getNeedTotals(): Promise<Map<string, number>> {
  const needRows = await db.select().from(require("../db/schema").need);
  const map = new Map<string, number>();
  
  const skuRows = await db.select().from(require("../db/schema").sku);
  const skuByCode = new Map(skuRows.map((s: any) => [s.id, s.code]));
  
  const recipeRows = await db.select().from(require("../db/schema").recipe);
  const statusByRecipe = new Map(recipeRows.map((r: any) => [r.id, r.status || ""]));
  
  for (const n of needRows) {
    const status = statusByRecipe.get(n.recipeId) || "";
    if (!["план", "в работе", "активен", "active"].includes(status)) continue;
    
    const skuCode = skuByCode.get(n.skuId) || "";
    if (!skuCode) continue;
    
    const cur = map.get(skuCode) || 0;
    map.set(skuCode, cur + (n.netQty || 0));
  }
  
  return map;
}

// ============================================================================
// Excluded / Исключения
// ============================================================================

export async function getExcludedList() {
  const rows = await db.select().from(require("../db/schema").excludedItem);
  return rows.map((r: any) => ({
    text: r.text,
    source_type: r.sourceType || "",
  }));
}

// ============================================================================
// Inbound (not yet migrated - placeholder)
// ============================================================================

export async function getInboundTotals(): Promise<Map<string, number>> {
  return new Map<string, number>();
}
