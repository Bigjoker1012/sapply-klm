/**
 * TZ 3.5 — PostgreSQL Read Layer for Supply KLM
 */

import { db } from "../db/client";
import { sql } from "drizzle-orm";

// ============================================================================
// SKU / Справочник сырья
// ============================================================================

export async function checkRecipeCodeExists(code: string): Promise<{ exists: boolean; recipeUid?: string; status?: string }> {
  const result = await db.execute(sql`SELECT recipe_uid, status FROM recipe WHERE code = ${code} LIMIT 1`);
  if (result.rows.length > 0) {
    return { exists: true, recipeUid: (result.rows[0] as any).recipe_uid, status: (result.rows[0] as any).status };
  }
  return { exists: false };
}

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

  // Fast-path duplicate check (optimization for normal case)
  const existing = await db.execute(sql`
    SELECT id FROM in_transit
    WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND eta_date = ${etaDate}
    AND status NOT IN ('received')
    LIMIT 1
  `);
  if (existing.rows.length > 0) {
    const existingId = (existing.rows[0] as any).id;
    console.log('[inbound] duplicate rejected (fast path): sku=' + raw_uid + ' wh=' + whCode + ' eta=' + etaDate + ' existing_id=' + existingId);
    return String(existingId);
  }

  // Attempt INSERT — catches race condition via UNIQUE constraint (SQLSTATE 23505)
  try {
    const result = await db.execute(sql`
      INSERT INTO in_transit (sku_id, supplier_id, warehouse_id, qty_kg, eta_date, status, po_ref)
      VALUES (${skuId}, ${supplierId}, ${warehouseId}, ${qty}, ${etaDate}, 'in_transit', ${document || null})
      RETURNING id
    `);
    return String((result.rows[0] as any).id);
  } catch (err: any) {
    // SQLSTATE 23505 = unique_violation — duplicate detected by UNIQUE index
    if (err.code === '23505' && err.constraint === 'idx_in_transit_no_dup') {
      const raceExisting = await db.execute(sql`
        SELECT id FROM in_transit
        WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND eta_date = ${etaDate}
        AND status NOT IN ('received')
        LIMIT 1
      `);
      if (raceExisting.rows.length > 0) {
        const existingId = (raceExisting.rows[0] as any).id;
        console.log('[inbound] duplicate rejected (race condition): sku=' + raw_uid + ' wh=' + whCode + ' eta=' + etaDate + ' existing_id=' + existingId);
        return String(existingId);
      }
    }
    // Re-throw non-duplicate errors (FK violations, connection errors, etc.)
    throw err;
  }
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
    // available_now = plant + lip (inbound NOT included — TZ 4.3)
    const available_now = round2(base - cons);
    out.push({
      raw_uid: uid, name: nameByUid.get(uid) || uid,
      plant_qty, lip_qty, inbound_qty, base,
      consumed: cons, available: available_now,
      signal: stockSignal(plant_qty, lip_qty, cons),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
}

/**
 * ETA-aware inbound totals: sum of inbound WHERE eta_date <= targetDate AND active.
 * Used for available_on_date(D) calculation.
 */
export async function getInboundByDate(targetDate: string): Promise<Map<string, number>> {
  const result = await db.execute(sql`
    SELECT s.code, SUM(i.qty_kg) as total
    FROM in_transit i
    JOIN sku s ON i.sku_id = s.id
    WHERE i.eta_date <= ${targetDate}
      AND i.status NOT IN ('received')
    GROUP BY s.code
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) map.set(row.code as string, parseFloat(row.total as string) || 0);
  return map;
}

/**
 * Find overdue inbound: ETA < today AND status != received.
 */
export async function getOverdueInbound(): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];
  const result = await db.execute(sql`
    SELECT s.code, i.qty_kg, i.eta_date, i.status
    FROM in_transit i
    JOIN sku s ON i.sku_id = s.id
    WHERE i.eta_date < ${today}
      AND i.status NOT IN ('received')
    ORDER BY i.eta_date
  `);
  return result.rows.map((r: any) => ({
    raw_uid: r.code, qty: r.qty_kg, eta_date: r.eta_date, status: r.status,
  }));
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

// ============================================================================
// Stock WRITE Layer (TZ 3.8.1)
// ============================================================================

/**
 * Write PlantStock snapshot for today.
 * Replaces all today's entries (transactional: delete old → insert new).
 */
export async function pgWritePlantStock(rows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[]): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const polotskId = 1;

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Delete existing snapshot for today
      await db.execute(sql`DELETE FROM stock_snapshot WHERE warehouse_id = ${polotskId} AND snapshot_date = ${today}`);

      // Build payload
      const payload = [];
      for (const row of rows) {
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${row.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;
        payload.push({ sku_id: skuId, qty_kg: row.qty });
      }

      if (payload.length > 0) {
        await db.execute(sql`
          INSERT INTO stock_snapshot (warehouse_id, snapshot_date, source, payload_json)
          VALUES (${polotskId}, ${today}, ${rows[0]?.source_file || 'upload'}, ${JSON.stringify(payload)})
        `);
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

/**
 * Write single LipStock position (updates today's snapshot).
 * Preserves other positions from the latest snapshot.
 */
export async function pgWriteLipStock(
  raw_uid: string, name_from_source: string,
  qty_on_hand: number, reserved_qty: number, free_qty: number, source: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const lipkovskayaId = 2;
  const free = free_qty >= 0 ? free_qty : Math.max(0, qty_on_hand - reserved_qty);

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Get latest snapshot
      const latest = await db.execute(sql`SELECT payload_json FROM stock_snapshot WHERE warehouse_id = ${lipkovskayaId} ORDER BY snapshot_date DESC LIMIT 1`);
      let existingPayload: any[] = latest.rows.length > 0 ? (latest.rows[0] as any).payload_json : [];
      if (!Array.isArray(existingPayload)) existingPayload = [];

      // Build new SKU map: keep existing + update/add this position
      const skuByCode = new Map<number, number>();
      for (const item of existingPayload) {
        skuByCode.set(Number(item.sku_id), Number(item.qty_kg));
      }

      // Update or add the target SKU
      const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${raw_uid}`);
      if (skuResult.rows.length > 0) {
        const skuId = (skuResult.rows[0] as any).id;
        skuByCode.set(skuId, free);
      }

      // Delete existing today's snapshot
      await db.execute(sql`DELETE FROM stock_snapshot WHERE warehouse_id = ${lipkovskayaId} AND snapshot_date = ${today}`);

      // Build new payload
      const newPayload = [];
      for (const [skuId, qty] of skuByCode) {
        newPayload.push({ sku_id: skuId, qty_kg: qty });
      }

      if (newPayload.length > 0) {
        await db.execute(sql`
          INSERT INTO stock_snapshot (warehouse_id, snapshot_date, source, payload_json)
          VALUES (${lipkovskayaId}, ${today}, ${source || 'upload'}, ${JSON.stringify(newPayload)})
        `);
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

/**
 * Write LipStock batch snapshot for today (full replace).
 * Used by upload/lipkovskaya and upload/lipkovskaya-kd.
 */
export async function pgWriteLipStockBatch(
  rows: { raw_uid: string; name_from_source: string; qty: number; source: string }[]
): Promise<void> {
  if (!rows.length) return;
  const today = new Date().toISOString().split('T')[0];
  const lipkovskayaId = 2;

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Delete existing today's snapshot
      await db.execute(sql`DELETE FROM stock_snapshot WHERE warehouse_id = ${lipkovskayaId} AND snapshot_date = ${today}`);

      // Build payload
      const payload = [];
      for (const row of rows) {
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${row.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;
        payload.push({ sku_id: skuId, qty_kg: row.qty });
      }

      if (payload.length > 0) {
        await db.execute(sql`
          INSERT INTO stock_snapshot (warehouse_id, snapshot_date, source, payload_json)
          VALUES (${lipkovskayaId}, ${today}, ${rows[0]?.source || 'upload'}, ${JSON.stringify(payload)})
        `);
      }

      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

/** Get stock snapshots (for /api/stock/snapshots endpoint) */
export async function pgGetStockSnapshots(warehouse: string): Promise<any[]> {
  const whCode = warehouse.toLowerCase().includes('липков') ? 'LIPKOV' : 'POLOTSK';
  const whResult = await db.execute(sql`SELECT id FROM warehouse WHERE code = ${whCode}`);
  if (whResult.rows.length === 0) return [];
  const whId = (whResult.rows[0] as any).id;

  const result = await db.execute(sql`
    SELECT snapshot_date, source, payload_json
    FROM stock_snapshot
    WHERE warehouse_id = ${whId}
    ORDER BY snapshot_date DESC
  `);
  return result.rows.map((r: any) => ({
    date: r.snapshot_date,
    source: r.source,
    items: Array.isArray(r.payload_json) ? r.payload_json.length : 0,
  }));
}

/** Delete stock snapshot by date */
export async function pgDeleteStockSnapshot(warehouse: string, date: string): Promise<number> {
  const whCode = warehouse.toLowerCase().includes('липков') ? 'LIPKOV' : 'POLOTSK';
  const whResult = await db.execute(sql`SELECT id FROM warehouse WHERE code = ${whCode}`);
  if (whResult.rows.length === 0) return 0;
  const whId = (whResult.rows[0] as any).id;

  const result = await db.execute(sql`DELETE FROM stock_snapshot WHERE warehouse_id = ${whId} AND snapshot_date = ${date}`);
  return (result as any).rowCount || 0;
}

// ============================================================================
// Need Layer (TZ 3.8.2)
// ============================================================================

/** Get need aggregated by SKU (used by planning/dashboard) */
export async function pgGetNeedList() {
  const result = await db.execute(sql`
    SELECT s.code, s.name, n.net_qty, n.period, r.code as recipe_code, r.status
    FROM need n
    JOIN sku s ON n.sku_id = s.id
    JOIN recipe r ON n.recipe_id = r.id
    WHERE r.status = 'active'
    ORDER BY s.code
  `);
  return result.rows.map((r: any) => ({
    raw_uid: r.code, name: r.name, net_qty: r.net_qty,
    period: r.period, recipe_code: r.recipe_code, status: r.status,
  }));
}

/** Get need by recipe */
export async function pgGetNeedByRecipe(recipeUid: string) {
  const result = await db.execute(sql`
    SELECT s.code, n.net_qty, n.period
    FROM need n
    JOIN sku s ON n.sku_id = s.id
    JOIN recipe r ON n.recipe_id = r.id
    WHERE r.recipe_uid = ${recipeUid}
  `);
  return result.rows.map((r: any) => ({ raw_uid: r.code, net_qty: r.net_qty, period: r.period }));
}

/** Get need aggregated by SKU for active recipes only */
export async function pgGetNeedBySku() {
  const result = await db.execute(sql`
    SELECT s.code, SUM(n.net_qty) as total
    FROM need n
    JOIN sku s ON n.sku_id = s.id
    JOIN recipe r ON n.recipe_id = r.id
    WHERE r.status = 'active'
    GROUP BY s.code
  `);
  const map = new Map<string, number>();
  for (const row of result.rows) map.set(row.code as string, parseFloat(row.total as string) || 0);
  return map;
}

// ============================================================================
// Aliases Layer (TZ 3.8.2)
// ============================================================================

export async function pgGetAliases() {
  const result = await db.execute(sql`
    SELECT sa.id, sa.alias, s.code as sku_code, s.name as sku_name, sa.source
    FROM sku_alias sa
    LEFT JOIN sku s ON sa.sku_id = s.id
    ORDER BY sa.alias
  `);
  return result.rows.map((r: any) => ({
    id: r.id, alias: r.alias, raw_uid: r.sku_code || '',
    source: r.source, sku_name: r.sku_name || '',
  }));
}

export async function pgGetAliasesBySku(rawUid: string) {
  const result = await db.execute(sql`
    SELECT sa.alias, sa.source FROM sku_alias sa
    JOIN sku s ON sa.sku_id = s.id
    WHERE s.code = ${rawUid}
  `);
  return result.rows.map((r: any) => ({ alias: r.alias, source: r.source }));
}

export async function pgAddAlias(rawUid: string, alias: string, source: string) {
  const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${rawUid}`);
  if (skuResult.rows.length === 0) throw new Error('SKU not found: ' + rawUid);
  const skuId = (skuResult.rows[0] as any).id;
  await db.execute(sql`
    INSERT INTO sku_alias (sku_id, alias, canonical_raw_uid, source)
    VALUES (${skuId}, ${alias}, ${rawUid}, ${source || 'manual'})
    ON CONFLICT DO NOTHING
  `);
}

export async function pgDeleteAlias(id: number) {
  await db.execute(sql`DELETE FROM sku_alias WHERE id = ${id}`);
}

/** Match text against aliases (priority: full_name → short_name → alias → normalized) */
export async function pgMatchAlias(text: string) {
  const result = await db.execute(sql`
    SELECT s.code, sa.alias, sa.source
    FROM sku_alias sa
    JOIN sku s ON sa.sku_id = s.id
    WHERE LOWER(sa.alias) = LOWER(${text})
    LIMIT 1
  `);
  if (result.rows.length > 0) return (result.rows[0] as any).code;
  // Try normalized match
  const norm = text.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
  const normResult = await db.execute(sql`
    SELECT s.code FROM sku_alias sa
    JOIN sku s ON sa.sku_id = s.id
    WHERE LOWER(REPLACE(sa.alias, ' ', '')) = ${norm}
    LIMIT 1
  `);
  if (normResult.rows.length > 0) return (normResult.rows[0] as any).code;
  return null;
}

// ============================================================================
// Analogs Layer (TZ 3.8.2)
// ============================================================================

export async function pgGetAnalogs() {
  const result = await db.execute(sql`
    SELECT a.id, s1.code as source_code, s1.name as source_name,
           s2.code as analog_code, s2.name as analog_name
    FROM analog a
    JOIN sku s1 ON a.sku_id = s1.id
    JOIN sku s2 ON a.analog_sku_id = s2.id
  `);
  return result.rows.map((r: any) => ({
    id: r.id, source_raw_uid: r.source_code, source_name: r.source_name,
    analog_raw_uid: r.analog_code, analog_name: r.analog_name,
  }));
}

export async function pgGetAnalogsBySku(rawUid: string) {
  const result = await db.execute(sql`
    SELECT s2.code, s2.name FROM analog a
    JOIN sku s1 ON a.sku_id = s1.id
    JOIN sku s2 ON a.analog_sku_id = s2.id
    WHERE s1.code = ${rawUid}
  `);
  return result.rows.map((r: any) => ({ raw_uid: r.code, name: r.name }));
}

export async function pgAddAnalog(sourceUid: string, analogUid: string) {
  const src = await db.execute(sql`SELECT id FROM sku WHERE code = ${sourceUid}`);
  const ana = await db.execute(sql`SELECT id FROM sku WHERE code = ${analogUid}`);
  if (src.rows.length === 0) throw new Error('Source SKU not found: ' + sourceUid);
  if (ana.rows.length === 0) throw new Error('Analog SKU not found: ' + analogUid);
  await db.execute(sql`
    INSERT INTO analog (sku_id, analog_sku_id) VALUES (${(src.rows[0] as any).id}, ${(ana.rows[0] as any).id})
    ON CONFLICT DO NOTHING
  `);
}

export async function pgDeleteAnalog(id: number) {
  await db.execute(sql`DELETE FROM analog WHERE id = ${id}`);
}

// ============================================================================
// Excluded Layer (TZ 3.8.2)
// ============================================================================

export async function pgGetExcluded() {
  const result = await db.execute(sql`SELECT id, text, source_type FROM excluded_item ORDER BY text`);
  return result.rows.map((r: any) => ({ id: r.id, text: r.text, source_type: r.source_type }));
}

export async function pgAddExcluded(text: string, sourceType: string) {
  await db.execute(sql`
    INSERT INTO excluded_item (text, source_type) VALUES (${text}, ${sourceType || 'manual'})
    ON CONFLICT DO NOTHING
  `);
}

export async function pgAddExcludedBatch(items: { text: string; source_type: string }[]) {
  for (const item of items) {
    await db.execute(sql`
      INSERT INTO excluded_item (text, source_type) VALUES (${item.text}, ${item.source_type || 'upload'})
      ON CONFLICT DO NOTHING
    `);
  }
}

export async function pgIsExcluded(text: string) {
  const result = await db.execute(sql`SELECT 1 FROM excluded_item WHERE LOWER(text) = LOWER(${text}) LIMIT 1`);
  return result.rows.length > 0;
}

export async function pgDeleteExcluded(id: number) {
  await db.execute(sql`DELETE FROM excluded_item WHERE id = ${id}`);
}

// ============================================================================
// Unresolved / ReviewQueue Layer (TZ 3.8.2)
// ============================================================================

export async function pgGetUnresolved() {
  const result = await db.execute(sql`
    SELECT id, text, source_type, file_name, qty, source_warehouse, resolved, created_at
    FROM unresolved_item
    WHERE resolved = false
    ORDER BY created_at DESC
  `);
  return result.rows.map((r: any) => ({
    id: r.id, text: r.text, source_type: r.source_type,
    file_name: r.file_name, qty: r.qty, source_warehouse: r.source_warehouse,
    resolved: r.resolved, created_at: r.created_at,
  }));
}

export async function pgAddUnresolved(text: string, sourceType: string, fileName: string, qty: number, warehouse: string) {
  await db.execute(sql`
    INSERT INTO unresolved_item (text, source_type, file_name, qty, source_warehouse, resolved)
    VALUES (${text}, ${sourceType}, ${fileName || ''}, ${qty || 0}, ${warehouse || ''}, false)
  `);
}

export async function pgAddUnresolvedBatch(items: { text: string; source_type: string; file_name: string; qty: number; source_warehouse: string }[]) {
  for (const item of items) {
    await db.execute(sql`
      INSERT INTO unresolved_item (text, source_type, file_name, qty, source_warehouse, resolved)
      VALUES (${item.text}, ${item.source_type || 'upload'}, ${item.file_name || ''}, ${item.qty || 0}, ${item.source_warehouse || ''}, false)
    `);
  }
}

export async function pgResolveUnresolved(id: number) {
  await db.execute(sql`UPDATE unresolved_item SET resolved = true, resolved_at = ${new Date().toISOString()} WHERE id = ${id}`);
}

export async function pgResolveUnresolvedByText(text: string) {
  await db.execute(sql`UPDATE unresolved_item SET resolved = true, resolved_at = ${new Date().toISOString()} WHERE text = ${text} AND resolved = false`);
}

export async function pgDeleteUnresolved(id: number) {
  await db.execute(sql`DELETE FROM unresolved_item WHERE id = ${id}`);
}

// ============================================================================
// matchBatch PG (TZ 3.8.3) — Identical algorithm, PG data source
// ============================================================================

// --- Constants (copied from sheetsService.ts) ---

const RU_TO_LAT: Record<string, string> = {
  "й":"q","ц":"w","у":"e","к":"r","е":"t","н":"y","г":"u","ш":"i","щ":"o","з":"p",
  "х":"[", "ъ":"]",
  "ф":"a","ы":"s","в":"d","а":"f","п":"g","р":"h","о":"j","л":"k","д":"l","ж":";","э":'\'',
  "я":"z","ч":"x","с":"c","м":"v","и":"b","т":"n","ь":"m","б":",","ю":".",
  "ё":"`",
};

const CYR_TO_LAT: Record<string, string> = {
  "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z",
  "и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r",
  "с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh",
  "щ":"shch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya",
};

const DENY_TOKENS = new Set<string>([
  "мешок", "мешки", "мешка", "мешков", "мешочек",
  "тара", "упаковка", "упак", "уп", "фасовка", "фасованный",
  "пакет", "пакеты", "коробка", "короб", "ящик", "ящ",
  "ведро", "канистра", "бочка", "фляга", "флакон", "банка",
  "биг", "бэг", "бег", "бигбэг", "бигбег", "паллета", "паллет", "поддон",
  "мкр", "полипропиленовый", "пп",
  "кг", "г", "гр", "грамм", "мг", "л", "мл", "т", "тн", "тонна", "тоннах",
  "шт", "штук", "штука", "штуки", "ед", "нетто", "брутто", "около",
]);

const NUM_UNIT_RE = /^\d+([.,]\d+)?(кг|г|гр|мг|л|мл|т|тн|шт|%)?$/;

// --- Helper functions (identical to sheetsService.ts) ---

function normalizeRawName(s: string): string {
  const lower = String(s).toLowerCase().trim();
  return lower.split("").map(ch => RU_TO_LAT[ch] ?? ch).join("");
}

function translitSuffix(s: string): string {
  return s.toLowerCase().split("").map(ch => CYR_TO_LAT[ch] ?? ch).join("");
}

function extractSuffixOriginal(s: string): string | null {
  const lower = String(s).toLowerCase().trim();
  const m = lower.match(/(?:витамин|вит|vitamin)\s+([a-zа-яё0-9]+)/i);
  if (m) return m[1];
  const tokens = lower.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (/^[a-zа-яё][0-9]*$/.test(last) && last.length <= 4) return last;
  return null;
}

function significantTokens(s: string): string[] {
  return String(s)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9%]+/gi, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !DENY_TOKENS.has(t) && !NUM_UNIT_RE.test(t));
}

function tokenMatchScore(aTokens: string[], bTokens: string[]): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const shared = [...bSet].filter(t => aSet.has(t));
  if (!shared.length) return 0;
  const bSubsetOfA = [...bSet].every(t => aSet.has(t));
  const aSubsetOfB = [...aSet].every(t => bSet.has(t));
  if (!bSubsetOfA && !aSubsetOfB) return 0;
  if (shared.length === 1 && shared[0].length < 5) return 0;
  return shared.reduce((sum, t) => sum + t.length, 0) + shared.length;
}

function normExcl(s: string): string {
  return String(s).toLowerCase().trim().replace(/\s+/g, " ");
}

// --- PG matchBatch ---

export async function pgMatchBatch(names: string[]): Promise<Map<string, string | null>> {
  // Load data from PG (same data as Sheets, different source)
  const [skuRows, aliasRows, excludedRows] = await Promise.all([
    db.execute(sql`SELECT code, name, short_name FROM sku WHERE active = true`),
    db.execute(sql`SELECT sa.alias, s.code FROM sku_alias sa JOIN sku s ON sa.sku_id = s.id`),
    db.execute(sql`SELECT text FROM excluded_item`),
  ]);

  const materials = skuRows.rows.map((r: any) => ({
    raw_uid: r.code,
    full_name: r.name,
    short_name: r.short_name || '',
  }));

  if (!materials.length) {
    throw new Error('matchBatch: каталог сырья (PG sku) пуст');
  }

  // Build lookup structures (identical to sheetsService)
  const byFullName = new Map(materials.map(m => [m.full_name.toLowerCase().trim(), m.raw_uid]));
  const byShortName = new Map(materials.map(m => [m.short_name.toLowerCase().trim(), m.raw_uid]));
  const byNormName = new Map(materials.map(m => [normalizeRawName(m.full_name), m.raw_uid]));
  const byNormShort = new Map(materials.map(m => [normalizeRawName(m.short_name), m.raw_uid]));

  // Aliases → canonical code
  const byAlias = new Map<string, string>();
  for (const row of aliasRows.rows) {
    const alias = String(row.alias).toLowerCase().trim();
    const code = String(row.code);
    if (alias && code) byAlias.set(alias, code);
  }

  // Excluded set
  const excludedSet = new Set<string>();
  for (const row of excludedRows.rows) {
    excludedSet.add(normExcl(String(row.text)));
  }

  // Pre-build token lists for fuzzy matching
  const aliasTokenList = Array.from(byAlias.entries())
    .map(([alias, uid]) => ({ uid, tokens: significantTokens(alias) }))
    .filter(e => e.tokens.length > 0);
  const materialTokenList = materials.map(m => ({
    uid: m.raw_uid,
    fullTokens: significantTokens(m.full_name),
    shortTokens: significantTokens(m.short_name),
  }));

  // Match each name (identical algorithm to sheetsService)
  const result = new Map<string, string | null>();
  for (const name of names) {
    // Skip excluded names
    if (excludedSet.has(normExcl(name))) { result.set(name, null); continue; }

    const n = name.toLowerCase().trim();
    if (byFullName.has(n))  { result.set(name, byFullName.get(n)!);  continue; }
    if (byShortName.has(n)) { result.set(name, byShortName.get(n)!); continue; }
    if (byAlias.has(n))     { result.set(name, byAlias.get(n)!);     continue; }

    // Normalized name (keyboard layout)
    const nn = normalizeRawName(name);
    if (byNormName.has(nn))  { result.set(name, byNormName.get(nn)!);  continue; }
    if (byNormShort.has(nn)) { result.set(name, byNormShort.get(nn)!); continue; }

    // Vitamin suffix check
    const inputSuffix = extractSuffixOriginal(name);
    if (inputSuffix) {
      const inputIsVit = /(?:витамин|вит|vitamin)/i.test(name);
      let suffixMatch: { uid: string } | null = null;
      let suffixMismatch = false;
      for (const m of materials) {
        const candSuffix = extractSuffixOriginal(m.full_name) ?? extractSuffixOriginal(m.short_name);
        if (!candSuffix) continue;
        const candIsVit = /(?:витамин|вит|vitamin)/i.test(m.full_name);
        if (inputIsVit && candIsVit) {
          if (translitSuffix(candSuffix) === translitSuffix(inputSuffix) || candSuffix === inputSuffix) {
            suffixMatch = { uid: m.raw_uid };
          } else {
            suffixMismatch = true;
          }
        }
      }
      if (suffixMatch) { result.set(name, suffixMatch.uid); continue; }
      if (suffixMismatch) { result.set(name, null); continue; }
    }

    // Fuzzy matching
    const nTokens = significantTokens(name);
    if (!nTokens.length) { result.set(name, null); continue; }

    let best: { uid: string; score: number } | null = null;
    for (const e of aliasTokenList) {
      const s = tokenMatchScore(nTokens, e.tokens);
      if (s > 0 && (!best || s > best.score)) best = { uid: e.uid, score: s };
    }
    for (const m of materialTokenList) {
      const sf = tokenMatchScore(nTokens, m.fullTokens);
      if (sf > 0 && (!best || sf > best.score)) best = { uid: m.uid, score: sf };
      const ss = tokenMatchScore(nTokens, m.shortTokens);
      if (ss > 0 && (!best || ss > best.score)) best = { uid: m.uid, score: ss };
    }
    result.set(name, best ? best.uid : null);
  }
  return result;
}

// ============================================================================
// LipBatches Layer (TZ 3.9.1)
// ============================================================================

export async function pgGetLipBatches() {
  const result = await db.execute(sql`
    SELECT l.id, s.code as raw_uid, l.snapshot_date, l.batch_code,
           l.vendor_name, l.qty_kg, l.unit, l.source, l.expiry_date, l.manufacture_date
    FROM lip_batch l JOIN sku s ON l.sku_id = s.id
    ORDER BY l.snapshot_date DESC, s.code
  `);
  return result.rows.map((r: any) => ({
    id: r.id, raw_uid: r.raw_uid, snapshot_date: r.snapshot_date,
    batch_code: r.batch_code, vendor_name: r.vendor_name, qty: r.qty_kg,
    unit: r.unit, source: r.source, expiry_date: r.expiry_date, manufacture_date: r.manufacture_date,
  }));
}

export async function pgWriteLipBatchesBulk(rows: {
  raw_uid: string; batch_code: string; vendor_name: string; qty: number;
  source: string; expiry_date?: string; manufacture_date?: string;
}[]): Promise<void> {
  if (!rows.length) return;
  const today = new Date().toISOString().split('T')[0];

  await db.execute(sql`BEGIN`).then(async () => {
    try {
      // Delete today's rows
      await db.execute(sql`DELETE FROM lip_batch WHERE snapshot_date = ${today}`);

      for (const row of rows) {
        const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${row.raw_uid}`);
        if (skuResult.rows.length === 0) continue;
        const skuId = (skuResult.rows[0] as any).id;
        await db.execute(sql`
          INSERT INTO lip_batch (sku_id, snapshot_date, batch_code, vendor_name, qty_kg, unit, source, expiry_date, manufacture_date)
          VALUES (${skuId}, ${today}, ${row.batch_code}, ${row.vendor_name}, ${row.qty}, 'кг', ${row.source || 'kd_file'}, ${row.expiry_date || null}, ${row.manufacture_date || null})
        `);
      }
      await db.execute(sql`COMMIT`);
    } catch (e) {
      await db.execute(sql`ROLLBACK`);
      throw e;
    }
  });
}

export async function pgUpdateLipBatchExpiry(rawUid: string, expiryDate: string | null, manufactureDate: string | null): Promise<number> {
  const skuResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${rawUid}`);
  if (skuResult.rows.length === 0) return 0;
  const skuId = (skuResult.rows[0] as any).id;

  // Find latest snapshot for this SKU
  const latest = await db.execute(sql`
    SELECT id, snapshot_date FROM lip_batch WHERE sku_id = ${skuId} ORDER BY snapshot_date DESC LIMIT 1
  `);
  if (latest.rows.length === 0) return 0;

  const batchId = (latest.rows[0] as any).id;
  await db.execute(sql`
    UPDATE lip_batch SET expiry_date = ${expiryDate || ''}, manufacture_date = ${manufactureDate || ''}
    WHERE id = ${batchId}
  `);
  return 1;
}

export async function pgGetLatestLipBatchStock(): Promise<Map<string, number>> {
  const result = await db.execute(sql`
    SELECT s.code, l.qty_kg, l.snapshot_date
    FROM lip_batch l JOIN sku s ON l.sku_id = s.id
    ORDER BY l.snapshot_date DESC
  `);
  const map = new Map<string, number>();
  const seenDates = new Map<string, string>();
  for (const row of result.rows) {
    const code = row.code as string;
    const date = row.snapshot_date as string;
    if (!seenDates.has(code) || seenDates.get(code) === date) {
      map.set(code, (map.get(code) || 0) + (parseFloat(row.qty_kg as string) || 0));
      seenDates.set(code, date);
    }
  }
  return map;
}

export async function pgFilterKdSimilar(names: string[]): Promise<Set<string>> {
  const keep = new Set<string>();
  if (!names.length) return keep;

  // Load reference data from PG
  const [skuRows, aliasRows, plantResult, recipeItemResult] = await Promise.all([
    db.execute(sql`SELECT name, short_name FROM sku WHERE active = true`),
    db.execute(sql`SELECT alias FROM sku_alias`),
    db.execute(sql`SELECT payload_json FROM stock_snapshot WHERE warehouse_id = 1 ORDER BY snapshot_date DESC LIMIT 1`),
    db.execute(sql`SELECT DISTINCT s.name FROM recipe_item ri JOIN sku s ON ri.sku_id = s.id`),
  ]);

  const refTexts: string[] = [];
  for (const r of skuRows.rows as any[]) { refTexts.push(String(r.name || "")); if (r.short_name) refTexts.push(String(r.short_name || "")); }
  for (const r of aliasRows.rows as any[]) refTexts.push(String(r.alias || ""));
  // PlantStock names from payload
  if (plantResult.rows.length > 0) {
    const payload = (plantResult.rows[0] as any).payload_json;
    if (Array.isArray(payload)) {
      const skuIds = payload.map((p: any) => p.sku_id);
      const skuNames = await db.execute(sql`SELECT id, name FROM sku WHERE id = ANY(${skuIds})`);
      for (const r of skuNames.rows as any[]) refTexts.push(String(r.name || ""));
    }
  }
  for (const r of recipeItemResult.rows as any[]) refTexts.push(String(r.name || ""));

  const refTokens = new Set<string>();
  for (const t of refTexts) for (const tok of significantTokens(String(t))) refTokens.add(tok);

  for (const name of names) {
    const toks = significantTokens(name);
    if (!toks.length) continue;
    const shared = toks.filter(t => refTokens.has(t));
    if (shared.some(t => t.length >= 4) || shared.length >= 2) keep.add(name);
  }
  return keep;
}

// ============================================================================
// RawMaterials CRUD (TZ 3.9.2)
// ============================================================================

export async function pgAddRawMaterial(data: {
  code: string; name: string; short_name?: string; unit?: string;
  category?: string; active?: boolean;
}) {
  const existing = await db.execute(sql`SELECT 1 FROM sku WHERE code = ${data.code}`);
  if (existing.rows.length > 0) throw new Error('SKU already exists: ' + data.code);
  await db.execute(sql`INSERT INTO sku (code, name, category, unit, active, short_name) VALUES (${data.code}, ${data.name}, ${data.category || 'other'}, ${data.unit || 'кг'}, ${data.active !== false}, ${data.short_name || null})`);
}

export async function pgUpdateRawMaterial(code: string, data: {
  name?: string; short_name?: string; unit?: string; active?: boolean; category?: string;
}) {
  if (data.name !== undefined) await db.execute(sql`UPDATE sku SET name = ${data.name} WHERE code = ${code}`);
  if (data.short_name !== undefined) await db.execute(sql`UPDATE sku SET short_name = ${data.short_name} WHERE code = ${code}`);
  if (data.unit !== undefined) await db.execute(sql`UPDATE sku SET unit = ${data.unit} WHERE code = ${code}`);
  if (data.active !== undefined) await db.execute(sql`UPDATE sku SET active = ${data.active} WHERE code = ${code}`);
  if (data.category !== undefined) await db.execute(sql`UPDATE sku SET category = ${data.category} WHERE code = ${code}`);
}

export async function pgDeleteRawMaterial(code: string): Promise<boolean> {
  const skuIdResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${code}`);
  if (skuIdResult.rows.length === 0) return false;
  const skuId = (skuIdResult.rows[0] as any).id;
  const depCount = await db.execute(sql`SELECT (SELECT count(*) FROM recipe_item WHERE sku_id = ${skuId}) as recipe_item, (SELECT count(*) FROM need WHERE sku_id = ${skuId}) as need, (SELECT count(*) FROM in_transit WHERE sku_id = ${skuId}) as in_transit, (SELECT count(*) FROM lip_batch WHERE sku_id = ${skuId}) as lip_batch, (SELECT count(*) FROM sku_alias WHERE sku_id = ${skuId}) as sku_alias`);
  const deps = depCount.rows[0] as any;
  const totalDeps = (parseInt(deps.recipe_item) || 0) + (parseInt(deps.need) || 0) + (parseInt(deps.in_transit) || 0) + (parseInt(deps.lip_batch) || 0) + (parseInt(deps.sku_alias) || 0);
  if (totalDeps > 0) throw new Error('Cannot delete ' + code + ': ' + totalDeps + ' dependent records exist');
  const result = await db.execute(sql`DELETE FROM sku WHERE code = ${code}`);
  return (result as any).rowCount > 0;
}

export async function pgMergeRawMaterials(sourceUid: string, targetUid: string, rename?: { full_name?: string; short_name?: string }) {
  if (!sourceUid || !targetUid || sourceUid === targetUid) throw new Error('Need two different codes');
  const sourceResult = await db.execute(sql`SELECT id, name FROM sku WHERE code = ${sourceUid}`);
  const targetResult = await db.execute(sql`SELECT id FROM sku WHERE code = ${targetUid}`);
  if (sourceResult.rows.length === 0) throw new Error('Source SKU not found: ' + sourceUid);
  if (targetResult.rows.length === 0) throw new Error('Target SKU not found: ' + targetUid);
  const sourceId = (sourceResult.rows[0] as any).id;
  const targetId = (targetResult.rows[0] as any).id;
  const sourceName = (sourceResult.rows[0] as any).name;
  let plant = 0, lip = 0, lipBatches = 0, inbound = 0, needCount = 0, aliasCount = 0;
  await db.execute(sql`BEGIN`);
  try {
    aliasCount = ((await db.execute(sql`UPDATE sku_alias SET sku_id = ${targetId} WHERE sku_id = ${sourceId}`)) as any).rowCount || 0;
    await db.execute(sql`UPDATE recipe_item SET sku_id = ${targetId} WHERE sku_id = ${sourceId}`);
    await db.execute(sql`UPDATE lip_batch SET sku_id = ${targetId} WHERE sku_id = ${sourceId}`);
    await db.execute(sql`UPDATE in_transit SET sku_id = ${targetId} WHERE sku_id = ${sourceId}`);
    const stockRows = await db.execute(sql`SELECT id, payload_json, warehouse_id FROM stock_snapshot`);
    for (const row of stockRows.rows) {
      const r = row as any;
      const payload = r.payload_json;
      if (!Array.isArray(payload)) continue;
      let changed = false;
      for (const item of payload) {
        if (Number(item.sku_id) === sourceId) { item.sku_id = targetId; changed = true; }
      }
      if (changed) {
        await db.execute(sql`UPDATE stock_snapshot SET payload_json = ${JSON.stringify(payload)}::jsonb WHERE id = ${r.id}`);
        if (r.warehouse_id === 1) plant++; else lip++;
      }
    }
    if (sourceName) await db.execute(sql`INSERT INTO sku_alias (sku_id, alias, canonical_raw_uid, source) VALUES (${targetId}, ${sourceName}, ${targetUid}, 'merge') ON CONFLICT DO NOTHING`);
    await db.execute(sql`UPDATE sku SET active = false, name = name || ' [MERGED to ' || ${targetUid} || ']' WHERE id = ${sourceId}`);
    await db.execute(sql`COMMIT`);
  } catch (e) {
    await db.execute(sql`ROLLBACK`);
    throw e;
  }
  return { plant, lip, lipBatches, inbound, need: needCount, aliases: aliasCount };
}

// ============================================================================
// getLipStockList PG (TZ 3.9.4)
// ============================================================================

export async function pgGetLipStockList() {
  const result = await db.execute(sql`
    SELECT s.code as raw_uid, s.name as name_from_source, s.short_name,
           l.qty_kg, l.unit, l.source, l.expiry_date, l.manufacture_date, l.snapshot_date
    FROM lip_batch l
    JOIN sku s ON l.sku_id = s.id
    WHERE l.snapshot_date = (SELECT MAX(snapshot_date) FROM lip_batch)
    ORDER BY s.code
  `);
  return result.rows.map((r: any) => ({
    snapshot_date: r.snapshot_date,
    raw_uid: r.raw_uid,
    name_from_source: r.name_from_source,
    qty_on_hand: r.qty_kg,
    reserved_qty: 0,
    free_qty: r.qty_kg,
    unit: r.unit || 'кг',
    source: r.source || 'kd_file',
    expiry_date: r.expiry_date,
    manufacture_date: r.manufacture_date,
  }));
}

// ============================================================================
// Partial Archive PG (TZ 3.9.4)
// ============================================================================

export async function pgPartialArchive(recipeUid: string, producedTons: number) {
  const recResult = await db.execute(sql`SELECT id, batch_t, base_batch_kg, status FROM recipe WHERE recipe_uid = ${recipeUid}`);
  if (recResult.rows.length === 0) throw new Error('Recipe not found');
  const rec = recResult.rows[0] as any;
  if (rec.status === 'archived') throw new Error('Already archived');

  const originalTons = rec.batch_t || 1;
  const recipeId = rec.id;
  const factor = producedTons / originalTons;

  await db.execute(sql`BEGIN`);
  try {
    // 1. Scale recipe_items for the current recipe
    await db.execute(sql`UPDATE recipe_item SET consumption_kg = ROUND((consumption_kg * ${factor})::numeric, 2) WHERE recipe_id = ${recipeId} AND consumption_kg > 0`);

    // 2. Update batch_t and base_batch_kg on current recipe
    await db.execute(sql`UPDATE recipe SET batch_t = ${producedTons}, base_batch_kg = ${producedTons * 1000} WHERE id = ${recipeId}`);

    // 3. Recalculate need for this recipe
    await db.execute(sql`DELETE FROM need WHERE recipe_id = ${recipeId}`);
    const items = await db.execute(sql`SELECT sku_id, consumption_kg FROM recipe_item WHERE recipe_id = ${recipeId} AND consumption_kg > 0`);
    const period = new Date().toISOString().slice(0, 7);
    for (const item of items.rows) {
      await db.execute(sql`INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at) VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, ${new Date().toISOString()})`);
    }

    // 4. Archive the current recipe
    await db.execute(sql`UPDATE recipe SET status = 'archived' WHERE id = ${recipeId}`);

    // 5. If there's remainder, create a new recipe
    const remaining = originalTons - producedTons;
    let newRecipeUid: string | null = null;
    if (remaining > 0.001) {
      const newRecResult = await db.execute(sql`INSERT INTO recipe (recipe_uid, code, name, status, batch_t, base_batch_kg, active_from) VALUES (${recipeUid + '_remaining_' + Date.now()}, (SELECT code FROM recipe WHERE id = ${recipeId}), (SELECT name FROM recipe WHERE id = ${recipeId}), 'active', ${remaining}, ${remaining * 1000}, ${new Date().toISOString().split('T')[0]}) RETURNING recipe_uid`);
      newRecipeUid = (newRecResult.rows[0] as any).recipe_uid;
      const newRecipeId = (newRecResult.rows[0] as any).id;

      // Copy recipe_items with remaining factor
      const remainFactor = 1 - factor;
      const allItems = await db.execute(sql`SELECT sku_id, dose_kg_per_t, norm_g_per_t, consumption_kg, match_status FROM recipe_item WHERE recipe_id = ${recipeId}`);
      const newPeriod = new Date().toISOString().slice(0, 7);
      for (const item of allItems.rows) {
        const newCons = round2(((item as any).consumption_kg || 0) * remainFactor);
        if (newCons > 0) {
          await db.execute(sql`INSERT INTO recipe_item (recipe_id, sku_id, dose_kg_per_t, norm_g_per_t, consumption_kg, match_status) VALUES (${newRecipeId}, ${(item as any).sku_id}, ${(item as any).dose_kg_per_t || 0}, ${(item as any).norm_g_per_t || 0}, ${newCons}, ${(item as any).match_status || 'matched'})`);
          await db.execute(sql`INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at) VALUES (${newRecipeId}, ${(item as any).sku_id}, ${newPeriod}, ${newCons}, 0, ${newCons}, ${new Date().toISOString()})`);
        }
      }
    }

    await db.execute(sql`COMMIT`);
    return { found: true, originalTons, producedTons, remainingTons: remaining, newRecipeUid };
  } catch (e) {
    await db.execute(sql`ROLLBACK`);
    throw e;
  }
}
