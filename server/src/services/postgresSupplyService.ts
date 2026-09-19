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

async function readStockSnapshot(warehouseId: number): Promise<Map<string, number>> {
  const result = await db.execute(sql`SELECT payload_json FROM stock_snapshot WHERE warehouse_id = ${warehouseId} ORDER BY snapshot_date DESC LIMIT 1`);
  if (result.rows.length === 0) return new Map();

  const payload = result.rows[0].payload_json as any[];
  if (!Array.isArray(payload)) return new Map();

  // Build SKU id→code map in one query
  const skuResult = await db.execute(sql`SELECT id, code FROM sku`) as any;
  const skuMap = new Map<number, string>();
  for (const row of skuResult.rows) {
    skuMap.set(Number(row.id), row.code);
  }

  // SUM by SKU code (matches Sheets behavior)
  const map = new Map<string, number>();
  for (const item of payload) {
    if (item.sku_id && item.qty_kg) {
      const skuId = Number(item.sku_id);
      const code = skuMap.get(skuId);
      if (code) {
        map.set(code, (map.get(code) || 0) + Number(item.qty_kg));
      }
    }
  }
  return map;
}

export async function getLatestPlantStock(): Promise<Map<string, number>> {
  return readStockSnapshot(1);
}

export async function getLatestLipStock(): Promise<Map<string, number>> {
  return readStockSnapshot(2);
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
// Inbound / Поставки в пути
// ============================================================================

export async function getInboundList() {
  const result = await db.execute(sql`
    SELECT i.id, s.code as raw_uid, s.name as raw_name, i.qty_kg, i.eta_date,
           i.status, i.po_ref, w.code as warehouse_code
    FROM in_transit i
    JOIN sku s ON i.sku_id = s.id
    JOIN warehouse w ON i.warehouse_id = w.id
    WHERE i.status NOT IN ('received')
    ORDER BY i.eta_date NULLS LAST
  `);
  return result.rows.map((r: any) => ({
    id: String(r.id),
    raw_uid: r.raw_uid,
    raw_name: r.raw_name,
    qty: r.qty_kg,
    eta: r.eta_date || '',
    destination: r.warehouse_code === 'LIPKOV' ? 'Липковская' : 'Полоцк',
    status: r.status === 'in_transit' ? 'в пути' : r.status === 'at_supplier' ? 'ожидается' : r.status === 'customs' ? 'таможня' : r.status,
    document: r.po_ref || '',
  }));
}

export async function getInboundTotals(): Promise<Map<string, number>> {
  const result = await db.execute(sql`
    SELECT s.code, SUM(i.qty_kg) as total
    FROM in_transit i
    JOIN sku s ON i.sku_id = s.id
    WHERE i.status NOT IN ('received')
    GROUP BY s.code
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.code as string, parseFloat(row.total as string) || 0);
  }
  return map;
}

export async function addInbound(raw_uid: string, raw_name: string, qty: number, eta: string, destination: string, document: string): Promise<string> {
  // Find SKU
  const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${raw_uid}`);
  if (skuResult.rows.length === 0) throw new Error('SKU not found: ' + raw_uid);
  const skuId = (skuResult.rows[0] as any).id;

  // Find warehouse
  const whCode = destination.toLowerCase().includes('липков') ? 'LIPKOV' : 'POLOTSK';
  const whResult = await db.execute(sql`SELECT id FROM warehouse WHERE code = ${whCode}`);
  const warehouseId = whResult.rows.length > 0 ? (whResult.rows[0] as any).id : 1;

  // Default supplier
  const supResult = await db.execute(sql`SELECT id FROM supplier LIMIT 1`);
  const supplierId = supResult.rows.length > 0 ? (supResult.rows[0] as any).id : 1;

  // Normalize ETA
  let etaDate = eta;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(eta)) {
    const p = eta.split('.');
    etaDate = p[2] + '-' + p[1] + '-' + p[0];
  }

  const result = await db.execute(sql`
    INSERT INTO in_transit (sku_id, supplier_id, warehouse_id, qty_kg, eta_date, status, po_ref)
    VALUES (${skuId}, ${supplierId}, ${warehouseId}, ${qty}, ${etaDate}, 'in_transit', ${document || null})
    RETURNING id
  `);

  return String((result.rows[0] as any).id);
}

export async function updateInboundStatus(id: string, status: string): Promise<void> {
  const statusMap: Record<string, string> = {
    'в пути': 'in_transit',
    'ожидается': 'at_supplier',
    'таможня': 'customs',
    'получено': 'received',
    'удалено': 'received',
  };
  const pgStatus = statusMap[status] || status;
  await db.execute(sql`UPDATE in_transit SET status = ${pgStatus} WHERE id = ${parseInt(id)}`);
}

export async function deleteInbound(id: string): Promise<void> {
  await updateInboundStatus(id, 'удалено');
}

export async function deleteInboundByMaterial(raw_uid: string): Promise<number> {
  const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${raw_uid}`);
  if (skuResult.rows.length === 0) return 0;
  const skuId = (skuResult.rows[0] as any).id;
  const result = await db.execute(sql`UPDATE in_transit SET status = 'received' WHERE sku_id = ${skuId} AND status NOT IN ('received')`);
  return (result as any).rowCount || 0;
}

// ============================================================================
// Live Stock / Живые остатки
// ============================================================================

/**
 * PG status mapping (Sheets → PG):
 *   план      → active   (stock consuming)
 *   в работе  → active   (stock consuming)
 *   активен   → active   (stock consuming, legacy)
 *   архив     → archived (NOT consuming)
 *   отменён   → (not in PG — recipes with this status were not migrated)
 *
 * STOCK_CONSUMING_STATUSES in PG = {'active'}
 */
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round3(n: number): number { return Math.round((n + Number.EPSILON) * 1000) / 1000; }

function stockSignal(plant_qty: number, lip_qty: number, consumed: number): "critical" | "transfer" | "ok" {
  const available = round2(plant_qty + lip_qty - consumed);
  if (available < -1e-6) return "critical";
  if (round2(plant_qty - consumed) < -1e-6) return "transfer";
  return "ok";
}

export async function getRecipeConsumption(): Promise<Map<string, number>> {
  // Only recipes with status='active' consume stock (plan + в работе + активен → active)
  const result = await db.execute(sql`
    SELECT s.code, SUM(ri.consumption_kg) as total
    FROM recipe_item ri
    JOIN recipe r ON ri.recipe_id = r.id
    JOIN sku s ON ri.sku_id = s.id
    WHERE r.status = 'active'
      AND ri.consumption_kg IS NOT NULL
      AND ri.consumption_kg > 0
    GROUP BY s.code
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.code as string, round3(parseFloat(row.total as string) || 0));
  }
  return map;
}

export async function getLiveStock() {
  const [plant, lip, inbound, consumed, catalog] = await Promise.all([
    getLatestPlantStock(),
    getLatestLipStock(),
    getInboundTotals(),
    getRecipeConsumption(),
    getAllRawMaterials(),
  ]);
  const nameByUid = new Map(catalog.map(m => [m.raw_uid, m.full_name]));
  const uids = new Set<string>([...plant.keys(), ...lip.keys(), ...inbound.keys(), ...consumed.keys()]);
  const out = [];
  for (const uid of uids) {
    const plant_qty = plant.get(uid) || 0;
    const lip_qty = lip.get(uid) || 0;
    const inbound_qty = inbound.get(uid) || 0;
    const base = round2(plant_qty + lip_qty);
    const cons = consumed.get(uid) || 0;
    out.push({
      raw_uid: uid, name: nameByUid.get(uid) || uid,
      plant_qty, lip_qty, inbound_qty, base,
      consumed: cons, available: round2(base + inbound_qty - cons),
      signal: stockSignal(plant_qty + inbound_qty, lip_qty, cons),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
}

export async function getStockDeficit() {
  const live = await getLiveStock();
  return (live as any[]).map((item: any) => ({ ...item, contributors: [] }));
}

// ============================================================================
// Recipe WRITE Layer (TZ 3.8)
// ============================================================================

/**
 * Status mapping: Sheets → PG
 *   план      → active   (consumes stock)
 *   в работе  → active   (consumes stock)
 *   активен   → active   (consumes stock, legacy)
 *   архив     → archived (does NOT consume)
 *   отменён   → archived (does NOT consume)
 *   удалён   → archived (does NOT consume)
 */
export const PG_RECIPE_STATUSES = {
  PLAN: 'active',
  IN_WORK: 'active',
  ARCHIVED: 'archived',
  CANCELLED: 'archived',
} as const;

/** Create recipe + recipe_items + need in a single transaction */
export async function pgWriteRecipe(recipe: {
  code: string; full_name: string; premix_name: string; date: string;
  batch_t: number; customer: string; file_name: string; base_batch_kg: number;
  lines: { raw_uid: string; name_from_recipe: string; input_pct: number;
           norm_g_per_t: number; consumption_kg: number; match_status: string; }[];
}): Promise<string> {
  return await db.execute(sql`BEGIN`).then(async () => {
    try {
      // 1. Create recipe
      const recResult = await db.execute(sql`
        INSERT INTO recipe (recipe_uid, code, name, status, batch_t, base_batch_kg, active_from)
        VALUES (${recipe.code + '_' + Date.now()}, ${recipe.code}, ${recipe.full_name}, 'active', ${recipe.batch_t}, ${recipe.base_batch_kg}, ${recipe.date})
        RETURNING id, recipe_uid
      `);
      const recipeId = (recResult.rows[0] as any).id;
      const recipeUid = (recResult.rows[0] as any).recipe_uid;

      // 2. Create recipe_items
      for (const line of recipe.lines) {
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${line.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;

        await db.execute(sql`
          INSERT INTO recipe_item (recipe_id, sku_id, dose_kg_per_t, norm_g_per_t, consumption_kg, match_status)
          VALUES (${recipeId}, ${skuId}, ${line.input_pct}, ${line.norm_g_per_t}, ${line.consumption_kg}, ${line.match_status})
        `);
      }

      // 3. Create need (only for matched items)
      const period = new Date().toISOString().slice(0, 7);
      for (const line of recipe.lines) {
        if (!line.raw_uid || line.consumption_kg <= 0) continue;
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${line.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;

        await db.execute(sql`
          INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
          VALUES (${recipeId}, ${skuId}, ${period}, ${line.consumption_kg}, 0, ${line.consumption_kg}, ${new Date().toISOString()})
        `);
      }

      await db.execute(sql`COMMIT`);
      return recipeUid;
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

/** Rewrite recipe_items + need for a recipe (used by updateRecipeTons, partial-archive) */
export async function pgRewriteRecipeItems(recipeUid: string, lines: {
  raw_uid: string; consumption_kg: number; norm_g_per_t: number; match_status: string;
}[]): Promise<void> {
  const recResult = await db.execute(sql`SELECT id FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) return;
  const recipeId = (recResult.rows[0] as any).id;

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Delete old recipe_items
      await db.execute(sql`DELETE FROM recipe_item WHERE recipe_id = ${recipeId}`);

      // Delete old need
      await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);

      // Insert new recipe_items + need
      const period = new Date().toISOString().slice(0, 7);
      for (const line of lines) {
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${line.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;

        await db.execute(sql`
          INSERT INTO recipe_item (recipe_id, sku_id, dose_kg_per_t, norm_g_per_t, consumption_kg, match_status)
          VALUES (${recipeId}, ${skuId}, 0, ${line.norm_g_per_t}, ${line.consumption_kg}, ${line.match_status})
        `);

        // Only create need for matched items
        if (line.raw_uid && line.consumption_kg > 0) {
          await db.execute(sql`
            INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
            VALUES (${recipeId}, ${skuId}, ${period}, ${line.consumption_kg}, 0, ${line.consumption_kg}, ${new Date().toISOString()})
          `);
        }
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

/** Set recipe status + recalculate need */
export async function pgSetRecipeStatus(recipeUid: string, status: string): Promise<boolean> {
  // Map Sheets status to PG status
  const statusMap: Record<string, string> = {
    'план': 'active', 'в работе': 'active', 'активен': 'active',
    'архив': 'archived', 'отменён': 'archived', 'удалён': 'archived',
    'plan': 'active', 'archive': 'archived', 'cancel': 'archived',
  };
  const pgStatus = statusMap[status] || status;

  const result = await db.execute(sql`UPDATE recipe SET status = ${pgStatus} WHERE recipe_uid = ${recipeUid} RETURNING id`);
  if (result.rows.length === 0) return false;

  const recipeId = (result.rows[0] as any).id;

  // Recalculate need based on consuming status
  const isConsuming = pgStatus === 'active';

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Delete old need
      await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);

      if (isConsuming) {
        // Re-create need from recipe_items
        const items = await db.execute(sql`
          SELECT ri.sku_id, ri.consumption_kg, s.code
          FROM recipe_item ri JOIN sku s ON ri.sku_id = s.id
          WHERE ri.recipe_id = ${recipeId} AND ri.consumption_kg > 0
        `);
        const period = new Date().toISOString().slice(0, 7);
        for (const item of items.rows) {
          await db.execute(sql`
            INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
            VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, ${new Date().toISOString()})
          `);
        }
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });

  return true;
}

/** Update recipe batch_t and scale all recipe_items + need proportionally */
export async function pgUpdateRecipeTons(recipeUid: string, newTons: number): Promise<{
  found: boolean; oldBatchT: number; newBatchT: number;
  needLines: { raw_uid: string; net_qty: number }[];
}> {
  const recResult = await db.execute(sql`SELECT id, batch_t, base_batch_kg FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) return { found: false, oldBatchT: 0, newBatchT: 0, needLines: [] };

  const recipeId = (recResult.rows[0] as any).id;
  const oldBatchT = (recResult.rows[0] as any).batch_t || 1;
  const factor = oldBatchT > 0 ? newTons / oldBatchT : 0;
  const newBaseKg = round2(newTons * 1000);

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Scale recipe_items
      await db.execute(sql`
        UPDATE recipe_item SET consumption_kg = ROUND((consumption_kg * ${factor})::numeric, 2)
        WHERE recipe_id = ${recipeId} AND consumption_kg > 0
      `);

      // Update recipe batch_t and base_batch_kg
      await db.execute(sql`UPDATE recipe SET batch_t = ${newTons}, base_batch_kg = ${newBaseKg} WHERE id = ${recipeId}`);

      // Recalculate need
      await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);
      const items = await db.execute(sql`
        SELECT sku_id, consumption_kg FROM recipe_item
        WHERE recipe_id = ${recipeId} AND consumption_kg > 0
      `);
      const period = new Date().toISOString().slice(0, 7);
      for (const item of items.rows) {
        await db.execute(sql`
          INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
          VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, ${new Date().toISOString()})
        `);
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });

  // Return needLines for compatibility
  const needResult = await db.execute(sql`
    SELECT s.code, n.net_qty FROM need n JOIN sku s ON n.sku_id = s.id WHERE n.recipe_id = ${recipeId}
  `);
  const needLines = needResult.rows.map((r: any) => ({ raw_uid: r.code, net_qty: r.net_qty }));

  return { found: true, oldBatchT, newBatchT: newTons, needLines };
}

/** Delete recipe + recipe_items + need (transactional) */
export async function pgDeleteRecipe(recipeUid: string): Promise<number> {
  const recResult = await db.execute(sql`SELECT id FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) return 0;
  const recipeId = (recResult.rows[0] as any).id;

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);
      await db.execute(sql`DELETE FROM recipe_item WHERE recipe_id = ${recipeId}`);
      await db.execute(sql`DELETE FROM recipe WHERE id = ${recipeId}`);
      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
  return 1;
}

/** Bulk delete recipes */
export async function pgDeleteRecipesBulk(recipeUids: string[]): Promise<number> {
  let removed = 0;
  for (const uid of recipeUids) {
    removed += await pgDeleteRecipe(uid);
  }
  return removed;
}

/** Delete need by recipe */
export async function pgDeleteNeedByRecipe(recipeUid: string): Promise<number> {
  const recResult = await db.execute(sql`SELECT id FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) return 0;
  const recipeId = (recResult.rows[0] as any).id;
  const result = await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);
  return (result as any).rowCount || 0;
}

/** Write need from recipe lines */
export async function pgWriteNeedFromRecipe(recipeUid: string, lines: { raw_uid: string; net_qty: number }[]): Promise<void> {
  const recResult = await db.execute(sql`SELECT id FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) return;
  const recipeId = (recResult.rows[0] as any).id;
  const period = new Date().toISOString().slice(0, 7);

  for (const line of lines) {
    if (!line.raw_uid || line.net_qty <= 0) continue;
    const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${line.raw_uid}`);
    if (skuResult.rows.length === 0) continue;
    const skuId = (skuResult.rows[0] as any).id;

    await db.execute(sql`
      INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
      VALUES (${recipeId}, ${skuId}, ${period}, ${line.net_qty}, 0, ${line.net_qty}, ${new Date().toISOString()})
    `);
  }
}
