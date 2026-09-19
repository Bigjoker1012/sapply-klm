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
} from "./postgresSupplyService";

import {
  getAllRawMaterials as sheetsGetAllRawMaterials,
  getLatestPlantStock as sheetsGetLatestPlantStock,
  getLatestLipStock as sheetsGetLatestLipStock,
  getRecipesList as sheetsGetRecipesList,
  getRecipeLines as sheetsGetRecipeLines,
  getNeedTotals as sheetsGetNeedTotals,
  getExcludedList as sheetsGetExcludedList,
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

export async function getInboundTotals(): Promise<Map<string, number>> {
  // Inbound not yet migrated to PG - always use Sheets
  const { getInboundTotals: sheetsGetInboundTotals } = await import("./sheetsService");
  return sheetsGetInboundTotals();
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
