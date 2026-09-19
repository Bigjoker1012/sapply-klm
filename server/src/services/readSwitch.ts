/**
 * TZ 3.5 — Read Switch for Supply KLM
 * 
 * Routes use this to choose between Sheets and PostgreSQL data sources.
 * Controlled by SUPPLY_DATA_SOURCE env var.
 */

import {
  getAllRawMaterials as pgGetAllRawMaterials,
  getLatestPlantStock as pgGetLatestPlantStock,
  getLatestLipStock as pgGetLatestLipStock,
  getRecipesList as pgGetRecipesList,
  getRecipeLines as pgGetRecipeLines,
  getNeedTotals as pgGetNeedTotals,
  getExcludedList as pgGetExcludedList,
  getInboundList as pgGetInboundList,
  getInboundTotals as pgGetInboundTotals,
  addInbound as pgAddInbound,
  updateInboundStatus as pgUpdateInboundStatus,
  deleteInbound as pgDeleteInbound,
  deleteInboundByMaterial as pgDeleteInboundByMaterial,
  getLiveStock as pgGetLiveStock,
  getStockDeficit as pgGetStockDeficit,
  pgWriteRecipe,
  pgSetRecipeStatus,
  pgUpdateRecipeTons,
  pgDeleteRecipe,
  pgDeleteRecipesBulk,
  pgDeleteNeedByRecipe,
  pgWriteNeedFromRecipe,
  pgRewriteRecipeItems,
  PG_RECIPE_STATUSES,
  pgWritePlantStock,
  pgWriteLipStock,
  pgWriteLipStockBatch,
  pgGetStockSnapshots,
  pgDeleteStockSnapshot,
} from "./postgresSupplyService";

import {
  getAllRawMaterials as sheetsGetAllRawMaterials,
  getLatestPlantStock as sheetsGetLatestPlantStock,
  getLatestLipStock as sheetsGetLatestLipStock,
  getRecipesList as sheetsGetRecipesList,
  getRecipeLines as sheetsGetRecipeLines,
  getNeedTotals as sheetsGetNeedTotals,
  getExcludedList as sheetsGetExcludedList,
  getInboundList as sheetsGetInboundList,
  getInboundTotals as sheetsGetInboundTotals,
  addInbound as sheetsAddInbound,
  updateInboundStatus as sheetsUpdateInboundStatus,
  deleteInbound as sheetsDeleteInbound,
  deleteInboundByMaterial as sheetsDeleteInboundByMaterial,
  getLiveStock as sheetsGetLiveStock,
  getStockDeficit as sheetsGetStockDeficit,
} from "./sheetsService";

const DATA_SOURCE = process.env.SUPPLY_DATA_SOURCE || "sheets";

function isPG(): boolean {
  return DATA_SOURCE === "postgres";
}

// ============================================================================
// Switched Functions
// ============================================================================

export async function getAllRawMaterials() {
  return isPG() ? pgGetAllRawMaterials() : sheetsGetAllRawMaterials();
}

export async function getLatestPlantStock() {
  return isPG() ? pgGetLatestPlantStock() : sheetsGetLatestPlantStock();
}

export async function getLatestLipStock() {
  return isPG() ? pgGetLatestLipStock() : sheetsGetLatestLipStock();
}

export async function getRecipesList() {
  return isPG() ? pgGetRecipesList() : sheetsGetRecipesList();
}

export async function getRecipeLines(recipe_uid: string) {
  return isPG() ? pgGetRecipeLines(recipe_uid) : sheetsGetRecipeLines(recipe_uid);
}

export async function getNeedTotals() {
  return isPG() ? pgGetNeedTotals() : sheetsGetNeedTotals();
}

export async function getExcludedList() {
  return isPG() ? pgGetExcludedList() : sheetsGetExcludedList();
}

export async function getInboundList() {
  return isPG() ? pgGetInboundList() : sheetsGetInboundList();
}

export async function getInboundTotals(): Promise<Map<string, number>> {
  return isPG() ? pgGetInboundTotals() : sheetsGetInboundTotals();
}

export async function addInbound(raw_uid: string, raw_name: string, qty: number, eta: string, destination: string, document: string): Promise<string> {
  return isPG() ? pgAddInbound(raw_uid, raw_name, qty, eta, destination, document) : sheetsAddInbound(raw_uid, raw_name, qty, eta, destination, document);
}

export async function updateInboundStatus(id: string, status: string): Promise<void> {
  return isPG() ? pgUpdateInboundStatus(id, status) : sheetsUpdateInboundStatus(id, status);
}

export async function deleteInbound(id: string): Promise<void> {
  return isPG() ? pgDeleteInbound(id) : sheetsDeleteInbound(id);
}

export async function deleteInboundByMaterial(raw_uid: string): Promise<number> {
  return isPG() ? pgDeleteInboundByMaterial(raw_uid) : sheetsDeleteInboundByMaterial(raw_uid);
}

export async function getLiveStock() {
  return isPG() ? pgGetLiveStock() : sheetsGetLiveStock();
}

export async function getStockDeficit() {
  return isPG() ? pgGetStockDeficit() : sheetsGetStockDeficit();
}

// ============================================================================
// Recipe Write Layer (TZ 3.8)
// ============================================================================

export { PG_RECIPE_STATUSES };

export async function writeRecipePG(recipe: {
  code: string; full_name: string; premix_name: string; date: string;
  batch_t: number; customer: string; file_name: string; base_batch_kg: number;
  lines: { raw_uid: string; name_from_recipe: string; input_pct: number;
           norm_g_per_t: number; consumption_kg: number; match_status: string; }[];
}): Promise<string> {
  return pgWriteRecipe(recipe);
}

export async function setRecipeStatusPG(recipeUid: string, status: string): Promise<boolean> {
  return pgSetRecipeStatus(recipeUid, status);
}

export async function updateRecipeTonsPG(recipeUid: string, newTons: number) {
  return pgUpdateRecipeTons(recipeUid, newTons);
}

export async function deleteRecipePG(recipeUid: string): Promise<number> {
  return pgDeleteRecipe(recipeUid);
}

export async function deleteRecipesBulkPG(recipeUids: string[]): Promise<number> {
  return pgDeleteRecipesBulk(recipeUids);
}

export async function deleteNeedByRecipePG(recipeUid: string): Promise<number> {
  return pgDeleteNeedByRecipe(recipeUid);
}

export async function writeNeedFromRecipePG(recipeUid: string, lines: { raw_uid: string; net_qty: number }[]): Promise<void> {
  return pgWriteNeedFromRecipe(recipeUid, lines);
}

export async function rewriteRecipeItemsPG(recipeUid: string, lines: {
  raw_uid: string; consumption_kg: number; norm_g_per_t: number; match_status: string;
}[]): Promise<void> {
  return pgRewriteRecipeItems(recipeUid, lines);
}

// ============================================================================
// Stock Write Layer (TZ 3.8.1)
// ============================================================================

export async function writePlantStock(rows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[]): Promise<void> {
  return pgWritePlantStock(rows);
}

export async function writeLipStock(
  raw_uid: string, name_from_source: string,
  qty_on_hand: number, reserved_qty: number, free_qty: number, source: string
): Promise<void> {
  return pgWriteLipStock(raw_uid, name_from_source, qty_on_hand, reserved_qty, free_qty, source);
}

export async function writeLipStockBatch(
  rows: { raw_uid: string; name_from_source: string; qty: number; source: string }[]
): Promise<void> {
  return pgWriteLipStockBatch(rows);
}

export async function getStockSnapshots(warehouse: string): Promise<any[]> {
  return pgGetStockSnapshots(warehouse);
}

export async function deleteStockSnapshot(warehouse: string, date: string): Promise<number> {
  return pgDeleteStockSnapshot(warehouse, date);
}

// Re-export sheets-only functions (not yet migrated)
export {
  getLipBatchesList,
  getAnalogs,
  getUnresolvedQueue,
  matchBatch,
  parseAliasRows,
  readRange,
  writeRange,
  appendRows,
  clearRange,
} from "./sheetsService";

export function getDataSource(): string {
  return DATA_SOURCE;
}
