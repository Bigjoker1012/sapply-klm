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
