/**
 * TZ 3.9.5 — PostgreSQL-only Data Layer for Supply KLM
 *
 * All functions read/write from PostgreSQL only.
 * Google Sheets is no longer used as a data source.
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
  pgGetNeedList,
  pgGetNeedByRecipe,
  pgGetNeedBySku,
  pgGetAliases,
  pgGetAliasesBySku,
  pgAddAlias,
  pgDeleteAlias,
  pgMatchAlias,
  pgGetAnalogs,
  pgGetAnalogsBySku,
  pgAddAnalog,
  pgDeleteAnalog,
  pgGetExcluded,
  pgAddExcluded,
  pgAddExcludedBatch,
  pgIsExcluded,
  pgDeleteExcluded,
  pgGetUnresolved,
  pgAddUnresolved,
  pgAddUnresolvedBatch,
  pgResolveUnresolved,
  pgResolveUnresolvedByText,
  pgDeleteUnresolved,
  pgMatchBatch,
  pgGetLipBatches,
  pgWriteLipBatchesBulk,
  pgUpdateLipBatchExpiry,
  pgGetLatestLipBatchStock,
  pgFilterKdSimilar,
  pgAddRawMaterial,
  pgUpdateRawMaterial,
  pgDeleteRawMaterial,
  pgMergeRawMaterials,
  pgGetLipStockList,
  pgPartialArchive,
  checkRecipeCodeExists as pgCheckRecipeCodeExists,
} from "./postgresSupplyService";

// ============================================================================
// Read Layer — PostgreSQL only
// ============================================================================

export async function getAllRawMaterials() { return pgGetAllRawMaterials(); }
export async function getLatestPlantStock() { return pgGetLatestPlantStock(); }
export async function getLatestLipStock() { return pgGetLatestLipStock(); }
export async function getRecipesList() { return pgGetRecipesList(); }
export async function getRecipeLines(recipe_uid: string) { return pgGetRecipeLines(recipe_uid); }
export async function getNeedTotals() { return pgGetNeedTotals(); }
export async function getExcludedList() { return pgGetExcludedList(); }
export async function getInboundList() { return pgGetInboundList(); }
export async function getInboundTotals(): Promise<Map<string, number>> { return pgGetInboundTotals(); }
export async function addInbound(raw_uid: string, raw_name: string, qty: number, eta: string, destination: string, document: string): Promise<string> { return pgAddInbound(raw_uid, raw_name, qty, eta, destination, document); }
export async function updateInboundStatus(id: string, status: string): Promise<void> { return pgUpdateInboundStatus(id, status); }
export async function deleteInbound(id: string): Promise<void> { return pgDeleteInbound(id); }
export async function deleteInboundByMaterial(raw_uid: string): Promise<number> { return pgDeleteInboundByMaterial(raw_uid); }
export async function getLiveStock() { return pgGetLiveStock(); }
export async function getStockDeficit() { return pgGetStockDeficit(); }

// ============================================================================
// Recipe Write Layer
// ============================================================================

export { PG_RECIPE_STATUSES };

export async function writeRecipePG(recipe: {
  code: string; full_name: string; premix_name: string; date: string;
  batch_t: number; customer: string; file_name: string; base_batch_kg: number;
  lines: { raw_uid: string; name_from_recipe: string; input_pct: number;
           norm_g_per_t: number; consumption_kg: number; match_status: string; }[];
}): Promise<string> { return pgWriteRecipe(recipe); }

export async function setRecipeStatusPG(recipeUid: string, status: string): Promise<boolean> { return pgSetRecipeStatus(recipeUid, status); }
export async function updateRecipeTonsPG(recipeUid: string, newTons: number) { return pgUpdateRecipeTons(recipeUid, newTons); }
export async function deleteRecipePG(recipeUid: string): Promise<number> { return pgDeleteRecipe(recipeUid); }
export async function deleteRecipesBulkPG(recipeUids: string[]): Promise<number> { return pgDeleteRecipesBulk(recipeUids); }
export async function deleteNeedByRecipePG(recipeUid: string): Promise<number> { return pgDeleteNeedByRecipe(recipeUid); }
export async function writeNeedFromRecipePG(recipeUid: string, lines: { raw_uid: string; net_qty: number }[]): Promise<void> { return pgWriteNeedFromRecipe(recipeUid, lines); }
export async function rewriteRecipeItemsPG(recipeUid: string, lines: { raw_uid: string; consumption_kg: number; norm_g_per_t: number; match_status: string; }[]): Promise<void> { return pgRewriteRecipeItems(recipeUid, lines); }

// ============================================================================
// Stock Write Layer
// ============================================================================

export async function writePlantStock(rows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[]): Promise<void> { return pgWritePlantStock(rows); }
export async function writeLipStock(raw_uid: string, name_from_source: string, qty_on_hand: number, reserved_qty: number, free_qty: number, source: string): Promise<void> { return pgWriteLipStock(raw_uid, name_from_source, qty_on_hand, reserved_qty, free_qty, source); }
export async function writeLipStockBatch(rows: { raw_uid: string; name_from_source: string; qty: number; source: string }[]): Promise<void> { return pgWriteLipStockBatch(rows); }
export async function getStockSnapshots(warehouse: string): Promise<any[]> { return pgGetStockSnapshots(warehouse); }
export async function deleteStockSnapshot(warehouse: string, date: string): Promise<number> { return pgDeleteStockSnapshot(warehouse, date); }

// ============================================================================
// Need Layer
// ============================================================================

export async function getNeedList() { return pgGetNeedList(); }
export async function getNeedByRecipe(recipeUid: string) { return pgGetNeedByRecipe(recipeUid); }
export async function getNeedBySku() { return pgGetNeedBySku(); }

// ============================================================================
// Aliases Layer
// ============================================================================

export async function getAliases() { return pgGetAliases(); }
export async function getAliasesBySku(rawUid: string) { return pgGetAliasesBySku(rawUid); }
export async function addAlias(rawUid: string, alias: string, source: string) { return pgAddAlias(rawUid, alias, source); }
export async function deleteAlias(id: number) { return pgDeleteAlias(id); }
export async function matchAlias(text: string) { return pgMatchAlias(text); }

// ============================================================================
// Analogs Layer
// ============================================================================

export async function getAnalogs() { return pgGetAnalogs(); }
export async function getAnalogsBySku(rawUid: string) { return pgGetAnalogsBySku(rawUid); }
export async function addAnalog(sourceUid: string, analogUid: string) { return pgAddAnalog(sourceUid, analogUid); }
export async function deleteAnalog(id: number) { return pgDeleteAnalog(id); }

// ============================================================================
// Excluded Layer
// ============================================================================

export async function getExcluded() { return pgGetExcluded(); }
export async function addExcluded(text: string, sourceType: string) { return pgAddExcluded(text, sourceType); }
export async function addExcludedBatch(items: { text: string; source_type: string; file_name?: string; qty?: number; source_warehouse?: string }[]) { return pgAddExcludedBatch(items); }
export async function isExcluded(text: string) { return pgIsExcluded(text); }
export async function deleteExcluded(id: number) { return pgDeleteExcluded(id); }

// ============================================================================
// Unresolved Layer
// ============================================================================

export async function getUnresolved() { return pgGetUnresolved(); }
export async function addUnresolved(text: string, sourceType: string, fileName: string, qty: number, warehouse: string) { return pgAddUnresolved(text, sourceType, fileName, qty, warehouse); }
export async function addUnresolvedBatch(items: { text: string; source_type: string; file_name: string; qty: number; source_warehouse: string }[]) { return pgAddUnresolvedBatch(items); }
export async function resolveUnresolved(id: number) { return pgResolveUnresolved(id); }
export async function resolveUnresolvedByText(text: string) { return pgResolveUnresolvedByText(text); }
export async function deleteUnresolved(id: number) { return pgDeleteUnresolved(id); }

// ============================================================================
// matchBatch
// ============================================================================

export async function matchBatch(names: string[]): Promise<Map<string, string | null>> { return pgMatchBatch(names); }

// ============================================================================
// LipBatches Layer
// ============================================================================

export async function getLipBatchesList() { return pgGetLipBatches(); }
export async function writeLipBatchesBulk(rows: { raw_uid: string; batch_code: string; vendor_name: string; qty: number; source: string; expiry_date?: string; manufacture_date?: string }[]) { return pgWriteLipBatchesBulk(rows); }
export async function updateLipBatchExpiry(rawUid: string, expiryDate: string | null, manufactureDate: string | null) { return pgUpdateLipBatchExpiry(rawUid, expiryDate, manufactureDate); }
export async function getLatestLipBatchStock() { return pgGetLatestLipBatchStock(); }
export async function filterKdSimilar(names: string[]) { return pgFilterKdSimilar(names); }

// ============================================================================
// RawMaterials CRUD
// ============================================================================

export async function addRawMaterial(data: { code: string; name: string; short_name?: string; unit?: string; category?: string; active?: boolean }) { return pgAddRawMaterial(data); }
export async function updateRawMaterial(code: string, data: { name?: string; short_name?: string; unit?: string; active?: boolean; category?: string }) { return pgUpdateRawMaterial(code, data); }
export async function deleteRawMaterial(code: string) { return pgDeleteRawMaterial(code); }
export async function mergeRawMaterials(sourceUid: string, targetUid: string, rename?: { full_name?: string; short_name?: string }) { return pgMergeRawMaterials(sourceUid, targetUid, rename); }

// ============================================================================
// getLipStockList + Partial Archive
// ============================================================================

export async function getLipStockList() { return pgGetLipStockList(); }
export async function partialArchive(recipeUid: string, producedTons: number) { return pgPartialArchive(recipeUid, producedTons); }
export async function checkRecipeCodeExists(code: string) { return pgCheckRecipeCodeExists(code); }
