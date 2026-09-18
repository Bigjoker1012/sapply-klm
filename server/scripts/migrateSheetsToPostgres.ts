import dotenv from "dotenv";
dotenv.config();

import { db } from "../src/db/client";
import { 
  sku, skuAlias, batch, recipe, recipeItem, need, inTransit,
  analog, excludedItem, unresolvedItem, warehouse, stockSnapshot, supplier,
  sql
} from "../src/db/schema";
import {
  getAllRawMaterials, getLatestPlantStock, getLatestLipStock,
  getLipBatchesList, getRecipesList, getRecipeLines,
  getInboundList, getUnresolvedQueue,
  getAnalogs, getExcludedList, parseAliasRows,
  readRange
} from "../src/services/sheetsService";

interface MigrationStats {
  entity: string;
  sheetsRows: number;
  pgRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logStats(stats: MigrationStats) {
  console.log(`  Sheets: ${stats.sheetsRows} | PG: ${stats.pgRows} | Inserted: ${stats.inserted} | Updated: ${stats.updated} | Skipped: ${stats.skipped} | Errors: ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    stats.errors.forEach(e => console.log(`    ERROR: ${e}`));
  }
}

// ============================================================================
// 1. SKU Migration
// ============================================================================
async function migrateSku(): Promise<MigrationStats> {
  log("=== 1. SKU Migration ===");
  const stats: MigrationStats = { entity: "sku", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const materials = await getAllRawMaterials();
    stats.sheetsRows = materials.length;
    log(`Sheets: ${materials.length} materials`);
    
    const existing = await db.select().from(sku);
    const existingByCode = new Map(existing.map(s => [s.code, s]));
    stats.pgRows = existing.length;
    log(`PG: ${existing.length} existing SKUs`);
    
    for (const m of materials) {
      const code = m.raw_uid;
      const name = m.full_name || m.raw_uid;
      const shortName = m.short_name || null;
      const unit = m.unit || "кг";
      const active = m.active !== false;
      
      if (existingByCode.has(code)) {
        const existingSku = existingByCode.get(code)!;
        if (existingSku.name !== name || existingSku.short_name !== shortName || existingSku.unit !== unit || existingSku.active !== active) {
          await db.update(sku).set({ name, short_name: shortName, unit, active }).where(sql`${sku.code} = ${code}`);
          stats.updated++;
        } else {
          stats.skipped++;
        }
      } else {
        await db.insert(sku).values({ code, name, short_name: shortName, category: "other", unit, active });
        stats.inserted++;
      }
    }
    logStats(stats);
  } catch (err: any) {
    stats.errors.push(err.message);
    log(`ERROR: ${err.message}`);
  }
  return stats;
}

// ============================================================================
// 2. Aliases Migration
// ============================================================================
async function migrateAliases(): Promise<MigrationStats> {
  log("=== 2. Aliases Migration ===");
  const stats: MigrationStats = { entity: "sku_alias", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const [aliasRows, materials] = await Promise.all([
      readRange("Aliases", "A2:D5000"),
      getAllRawMaterials()
    ]);
    const aliases = parseAliasRows(aliasRows, materials);
    stats.sheetsRows = aliases.length;
    log(`Sheets: ${aliases.length} aliases`);
    
    const existing = await db.select().from(skuAlias);
    const existingSet = new Set(existing.map(a => `${a.skuId}|${a.synonym.toLowerCase()}`));
    stats.pgRows = existing.length;
    log(`PG: ${existing.length} existing aliases`);
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    
    for (const a of aliases) {
      const skuId = skuByCode.get(a.canonical_raw_uid);
      if (!skuId) { stats.errors.push(`SKU not found for alias: ${a.synonym} → ${a.canonical_raw_uid}`); continue; }
      const aliasKey = `${skuId}|${a.synonym.toLowerCase()}`;
      if (existingSet.has(aliasKey)) { stats.skipped++; continue; }
      await db.insert(skuAlias).values({ skuId, alias: a.synonym, source: (a.source || "manual") as any });
      stats.inserted++;
    }
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 3. Stock Snapshot Migration
// ============================================================================
async function migrateStock(): Promise<MigrationStats> {
  log("=== 3. Stock Snapshot Migration ===");
  const stats: MigrationStats = { entity: "stock_snapshot", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const warehouses = await db.select().from(warehouse);
    const whByCode = new Map(warehouses.map(w => [w.code, w.id]));
    const polotskId = whByCode.get("POLOTSK") || 1;
    const lipkovskayaId = whByCode.get("LIPKOV") || 2;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    
    const today = new Date().toISOString().split("T")[0];
    
    // PlantStock
    log("Migrating PlantStock...");
    const plantStock = await getLatestPlantStock();
    stats.sheetsRows = plantStock.size;
    const plantPayload: any[] = [];
    for (const [raw_uid, qty] of plantStock) {
      const skuId = skuByCode.get(raw_uid);
      if (!skuId) { stats.errors.push(`SKU not found: ${raw_uid}`); continue; }
      plantPayload.push({ sku_id: skuId, qty_kg: qty });
    }
    if (plantPayload.length > 0) {
      const existing = await db.select().from(stockSnapshot).where(sql`${stockSnapshot.warehouseId} = ${polotskId} AND ${stockSnapshot.snapshotDate} = ${today}`);
      if (existing.length === 0) {
        await db.insert(stockSnapshot).values({ warehouseId: polotskId, snapshotDate: today, source: "migration_3_3", payloadJson: plantPayload });
        stats.inserted++;
      } else { stats.skipped++; }
    }
    
    // LipStock
    log("Migrating LipStock...");
    const lipStock = await getLatestLipStock();
    stats.sheetsRows += lipStock.size;
    const lipPayload: any[] = [];
    for (const [raw_uid, qty] of lipStock) {
      const skuId = skuByCode.get(raw_uid);
      if (!skuId) { stats.errors.push(`SKU not found: ${raw_uid}`); continue; }
      lipPayload.push({ sku_id: skuId, qty_kg: qty });
    }
    if (lipPayload.length > 0) {
      const existing = await db.select().from(stockSnapshot).where(sql`${stockSnapshot.warehouseId} = ${lipkovskayaId} AND ${stockSnapshot.snapshotDate} = ${today}`);
      if (existing.length === 0) {
        await db.insert(stockSnapshot).values({ warehouseId: lipkovskayaId, snapshotDate: today, source: "migration_3_3", payloadJson: lipPayload });
        stats.inserted++;
      } else { stats.skipped++; }
    }
    stats.pgRows = (await db.select().from(stockSnapshot)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 4. Batches Migration
// ============================================================================
async function migrateBatches(): Promise<MigrationStats> {
  log("=== 4. Batches Migration ===");
  const stats: MigrationStats = { entity: "batch", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const batches = await getLipBatchesList();
    stats.sheetsRows = batches.length;
    log(`Sheets: ${batches.length} batches`);
    
    const existing = await db.select().from(batch);
    const existingSet = new Set(existing.map(b => `${b.skuId}|${b.lotNo || ""}|${b.warehouseId}`));
    stats.pgRows = existing.length;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    const warehouses = await db.select().from(warehouse);
    const whByCode = new Map(warehouses.map(w => [w.code, w.id]));
    const lipkovskayaId = whByCode.get("LIPKOV") || 2;
    
    for (const b of batches) {
      const skuId = skuByCode.get(b.raw_uid);
      if (!skuId) { stats.errors.push(`SKU not found: ${b.raw_uid}`); continue; }
      const batchKey = `${skuId}|${b.batch_code || ""}|${lipkovskayaId}`;
      if (existingSet.has(batchKey)) { stats.skipped++; continue; }
      try {
        await db.insert(batch).values({
          skuId, warehouseId: lipkovskayaId, lotNo: b.batch_code || null,
          vendorName: b.vendor_name || null, initialQtyKg: b.qty || 0,
          currentQtyKg: b.qty || 0, expiryDate: b.expiry_date || null,
          manufactureDate: b.manufacture_date || null, status: "active",
        });
        stats.inserted++;
      } catch (e: any) { stats.errors.push(`Batch ${b.raw_uid}: ${e.message}`); }
    }
    stats.pgRows = (await db.select().from(batch)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 5. Recipes Migration
// ============================================================================
async function migrateRecipes(): Promise<MigrationStats> {
  log("=== 5. Recipes Migration ===");
  const stats: MigrationStats = { entity: "recipe", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const recipes = await getRecipesList();
    stats.sheetsRows = recipes.length;
    log(`Sheets: ${recipes.length} recipes`);
    
    const existing = await db.select().from(recipe);
    const existingByUid = new Map(existing.map(r => [r.recipe_uid || "", r]));
    const existingByCode = new Set(existing.map(r => `${r.code || ""}|${r.version || 1}`));
    stats.pgRows = existing.length;
    
    for (const r of recipes) {
      const recipeUid = r.recipe_uid;
      if (!recipeUid) { stats.errors.push(`Recipe without UID: ${r.code}`); continue; }
      const codeKey = `${r.code || ""}|1`;
      if (existingByUid.has(recipeUid) || existingByCode.has(codeKey)) { stats.skipped++; continue; }
      
      let status: string = "active";
      if (r.status === "отменён" || r.status === "archived") status = "archived";
      else if (r.status === "план") status = "active";
      else if (r.status === "в работе") status = "active";
      
      try {
        await db.insert(recipe).values({
          recipe_uid: recipeUid, code: r.code || "", name: r.full_name || r.code || "",
          targetAnimal: "other", version: 1, status: status as any,
          batch_t: r.batch_t || null, base_batch_kg: r.base_batch_kg || null,
          activeFrom: r.date || null,
        });
        stats.inserted++;
      } catch (e: any) { stats.errors.push(`Recipe ${recipeUid}: ${e.message}`); }
    }
    stats.pgRows = (await db.select().from(recipe)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 6. Recipe Items Migration
// ============================================================================
async function migrateRecipeItems(): Promise<MigrationStats> {
  log("=== 6. Recipe Items Migration ===");
  const stats: MigrationStats = { entity: "recipe_item", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const allRows = await readRange("RecipeLines", "A2:L5000");
    const lines = allRows.filter(r => r[1]).map(r => ({
      recipe_uid: String(r[1] || ""), raw_uid: String(r[2] || ""),
      input_pct: parseFloat(String(r[5] || "0")) || 0,
      norm_g_per_t: parseFloat(String(r[6] || "0")) || 0,
      consumption_kg: parseFloat(String(r[7] || "0")) || 0,
      match_status: String(r[11] || ""),
    }));
    stats.sheetsRows = lines.length;
    log(`Sheets: ${lines.length} recipe lines`);
    
    const existing = await db.select().from(recipeItem);
    const existingSet = new Set(existing.map(ri => `${ri.recipeId}|${ri.skuId}`));
    stats.pgRows = existing.length;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    const recipeRows = await db.select().from(recipe);
    const recipeByUid = new Map(recipeRows.map(r => [r.recipe_uid || "", r.id]));
    
    for (const l of lines) {
      const recipeId = recipeByUid.get(l.recipe_uid);
      const skuId = skuByCode.get(l.raw_uid);
      if (!recipeId) continue;
      if (!skuId) { stats.errors.push(`SKU not found: ${l.raw_uid}`); continue; }
      const itemKey = `${recipeId}|${skuId}`;
      if (existingSet.has(itemKey)) { stats.skipped++; continue; }
      try {
        await db.insert(recipeItem).values({
          recipeId, skuId, doseKgPerT: l.input_pct || 0,
          norm_g_per_t: l.norm_g_per_t || null, consumption_kg: l.consumption_kg || null,
          match_status: l.match_status || null, sortOrder: 0,
        });
        stats.inserted++;
      } catch (e: any) { stats.errors.push(`Item ${l.recipe_uid}/${l.raw_uid}: ${e.message}`); }
    }
    stats.pgRows = (await db.select().from(recipeItem)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 7. Need Migration
// ============================================================================
async function migrateNeed(): Promise<MigrationStats> {
  log("=== 7. Need Migration ===");
  const stats: MigrationStats = { entity: "need", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const needRows = await readRange("Need", "A2:H5000");
    const validRows = needRows.filter(r => r[0] && r[1] && r[2]);
    stats.sheetsRows = validRows.length;
    log(`Sheets: ${validRows.length} need rows`);
    
    const existing = await db.select().from(need);
    stats.pgRows = existing.length;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    const recipeRows = await db.select().from(recipe);
    const recipeByUid = new Map(recipeRows.map(r => [r.recipe_uid || "", r.id]));
    const existingSet = new Set(existing.map(n => `${n.recipeId}|${n.skuId}|${n.period}`));
    
    for (const r of validRows) {
      const recipeId = recipeByUid.get(String(r[1] || ""));
      const skuId = skuByCode.get(String(r[2] || ""));
      if (!recipeId || !skuId) continue;
      const needKey = `${recipeId}|${skuId}|${String(r[3] || "")}`;
      if (existingSet.has(needKey)) { stats.skipped++; continue; }
      try {
        await db.insert(need).values({
          recipeId, skuId, period: String(r[3] || ""),
          grossQty: parseFloat(String(r[4] || "0")) || 0,
          adjustment: parseFloat(String(r[5] || "0")) || 0,
          netQty: parseFloat(String(r[6] || "0")) || 0, version: 1,
        });
        stats.inserted++;
      } catch (e: any) { stats.errors.push(`Need ${r[1]}/${r[2]}: ${e.message}`); }
    }
    stats.pgRows = (await db.select().from(need)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 8. Inbound Migration
// ============================================================================
async function migrateInbound(): Promise<MigrationStats> {
  log("=== 8. Inbound Migration ===");
  const stats: MigrationStats = { entity: "in_transit", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const inboundList = await getInboundList();
    stats.sheetsRows = inboundList.length;
    log(`Sheets: ${inboundList.length} inbound items`);
    
    const existing = await db.select().from(inTransit);
    stats.pgRows = existing.length;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    const supplierRows = await db.select().from(supplier);
    const supplierByName = new Map(supplierRows.map(s => [s.name, s.id]));
    const warehouses = await db.select().from(warehouse);
    const whByCode = new Map(warehouses.map(w => [w.code, w.id]));
    
    for (const item of inboundList) {
      const skuId = skuByCode.get(item.raw_uid);
      if (!skuId) { stats.errors.push(`SKU not found: ${item.raw_uid}`); continue; }
      let supplierId = supplierByName.get(item.supplier || "");
      if (!supplierId && item.supplier) {
        const ns = await db.insert(supplier).values({ name: item.supplier }).returning();
        supplierId = ns[0].id; supplierByName.set(item.supplier, supplierId);
      }
      try {
        await db.insert(inTransit).values({
          skuId, supplierId: supplierId || 1, warehouseId: whByCode.get("POLOTSK") || 1,
          qtyKg: item.qty || 0, etaDate: item.eta || null,
          status: (item.status || "in_transit") as any, poRef: item.destination || null,
        });
        stats.inserted++;
      } catch (e: any) { stats.errors.push(`Inbound ${item.raw_uid}: ${e.message}`); }
    }
    stats.pgRows = (await db.select().from(inTransit)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 9. Unresolved Items Migration
// ============================================================================
async function migrateUnresolved(): Promise<MigrationStats> {
  log("=== 9. Unresolved Items Migration ===");
  const stats: MigrationStats = { entity: "unresolved_item", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const queue = await getUnresolvedQueue();
    stats.sheetsRows = queue.length;
    log(`Sheets: ${queue.length} unresolved items`);
    
    const existing = await db.select().from(unresolvedItem);
    const existingTexts = new Set(existing.map(u => u.text.toLowerCase()));
    stats.pgRows = existing.length;
    
    for (const item of queue) {
      const text = item.text || "";
      await db.insert(unresolvedItem).values({
        text, sourceType: item.source_type || "unknown", fileName: item.file_name || null,
        qty: item.qty || null, sourceWarehouse: item.source_warehouse || null, resolved: false,
      });
      stats.inserted++; existingTexts.add(text.toLowerCase());
    }
    stats.pgRows = (await db.select().from(unresolvedItem)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 10. Analogs Migration
// ============================================================================
async function migrateAnalogs(): Promise<MigrationStats> {
  log("=== 10. Analogs Migration ===");
  const stats: MigrationStats = { entity: "analog", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const analogs = await getAnalogs();
    stats.sheetsRows = analogs.length;
    log(`Sheets: ${analogs.length} analogs`);
    
    const existing = await db.select().from(analog);
    const existingSet = new Set(existing.map(a => `${a.skuId}|${a.analogSkuId}`));
    stats.pgRows = existing.length;
    
    const skuRows = await db.select().from(sku);
    const skuByCode = new Map(skuRows.map(s => [s.code, s.id]));
    
    for (const a of analogs) {
      const skuId = skuByCode.get(a.raw_uid);
      const analogSkuId = skuByCode.get(a.analog_raw_uid);
      if (!skuId || !analogSkuId) { stats.errors.push(`SKU not found: ${a.raw_uid} → ${a.analog_raw_uid}`); continue; }
      if (skuId === analogSkuId) { stats.errors.push(`Self-reference: ${a.raw_uid}`); continue; }
      const pairKey = `${skuId}|${analogSkuId}`;
      if (existingSet.has(pairKey)) { stats.skipped++; continue; }
      await db.insert(analog).values({ skuId, analogSkuId, note: a.note || null });
      stats.inserted++;
    }
    stats.pgRows = (await db.select().from(analog)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// 11. Excluded Migration
// ============================================================================
async function migrateExcluded(): Promise<MigrationStats> {
  log("=== 11. Excluded Migration ===");
  const stats: MigrationStats = { entity: "excluded_item", sheetsRows: 0, pgRows: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const excluded = await getExcludedList();
    stats.sheetsRows = excluded.length;
    log(`Sheets: ${excluded.length} excluded items`);
    
    const existing = await db.select().from(excludedItem);
    const existingTexts = new Set(existing.map(e => e.text.toLowerCase()));
    stats.pgRows = existing.length;
    
    for (const item of excluded) {
      const text = item.text || "";
      if (!text || existingTexts.has(text.toLowerCase())) { stats.skipped++; continue; }
      await db.insert(excludedItem).values({ text, sourceType: item.source_type || null });
      stats.inserted++; existingTexts.add(text.toLowerCase());
    }
    stats.pgRows = (await db.select().from(excludedItem)).length;
    logStats(stats);
  } catch (err: any) { stats.errors.push(err.message); log(`ERROR: ${err.message}`); }
  return stats;
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  log("========================================");
  log("ТЗ 3.3 — Migration: Sheets → PostgreSQL");
  log("========================================");
  
  const allStats: MigrationStats[] = [];
  const allErrors: string[] = [];
  
  try {
    allStats.push(await migrateSku());
    allStats.push(await migrateAliases());
    allStats.push(await migrateStock());
    allStats.push(await migrateBatches());
    allStats.push(await migrateRecipes());
    allStats.push(await migrateRecipeItems());
    allStats.push(await migrateNeed());
    allStats.push(await migrateInbound());
    allStats.push(await migrateUnresolved());
    allStats.push(await migrateAnalogs());
    allStats.push(await migrateExcluded());
    
    log("");
    log("========================================");
    log("MIGRATION SUMMARY");
    log("========================================");
    
    let totalInserted = 0;
    let totalErrors = 0;
    
    for (const s of allStats) {
      totalInserted += s.inserted;
      totalErrors += s.errors.length;
      allErrors.push(...s.errors);
      log(`${s.entity}: Sheets=${s.sheetsRows} PG=${s.pgRows} Inserted=${s.inserted} Errors=${s.errors.length}`);
    }
    
    log("");
    log(`Total inserted: ${totalInserted}`);
    log(`Total errors: ${totalErrors}`);
    
    if (allErrors.length > 0) {
      log("");
      log("ERRORS:");
      allErrors.forEach(e => log(`  - ${e}`));
    }
  } catch (err: any) {
    log(`FATAL ERROR: ${err.message}`);
    console.error(err);
  }
}

main().catch(console.error);
