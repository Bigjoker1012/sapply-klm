import { ReplitConnectors } from "@replit/connectors-sdk";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1XLQ1FSJOXLwIgEhbAtz95yrVXbEzBYQkAgQ5XEnLxOA";

function getConn() {
  return new ReplitConnectors();
}

async function sheetGet(path: string) {
  const c = getConn();
  const r = await c.proxy("google-sheet", path, { method: "GET" });
  return r.json();
}

async function sheetPost(path: string, body: object) {
  const c = getConn();
  const r = await c.proxy("google-sheet", path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

async function sheetPut(path: string, body: object) {
  const c = getConn();
  const r = await c.proxy("google-sheet", path, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

export async function readRange(sheet: string, range: string): Promise<any[][]> {
  const fullRange = `${sheet}!${range}`;
  const d = await sheetGet(`/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}`);
  return d.values || [];
}

export async function clearRange(sheet: string, range: string): Promise<void> {
  await sheetPost(`/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${range}`)}:clear`, {});
}

export async function writeRange(sheet: string, range: string, values: any[][]): Promise<void> {
  await sheetPut(
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${range}`)}?valueInputOption=USER_ENTERED`,
    { values }
  );
}

export async function appendRows(sheet: string, values: any[][]): Promise<void> {
  await sheetPost(
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values }
  );
}

// ─── RAW MATERIALS (Syryo) ─────────────────────────────────────────────────

export interface RawMaterial {
  raw_uid: string;
  full_name: string;
  short_name: string;
  unit: string;
  avg_monthly_usage: number;
  reorder_threshold_factor: number;
  lead_time_days: number;
  active: boolean;
}

export async function getAllRawMaterials(): Promise<RawMaterial[]> {
  const rows = await readRange("Syryo", "A2:H1000");
  return rows
    .filter(r => r[0] && r[1])
    .map(r => ({
      raw_uid: String(r[0] || ""),
      full_name: String(r[1] || ""),
      short_name: String(r[2] || ""),
      unit: String(r[3] || "кг"),
      avg_monthly_usage: parseFloat(r[4]) || 0,
      reorder_threshold_factor: parseFloat(r[5]) || 0.5,
      lead_time_days: parseInt(r[6]) || 30,
      active: String(r[7]).toUpperCase() !== "FALSE",
    }));
}

export async function findRawByAlias(alias: string): Promise<string | null> {
  const normalized = alias.toLowerCase().trim();
  const materials = await getAllRawMaterials();

  // Direct match
  const direct = materials.find(
    m => m.full_name.toLowerCase().trim() === normalized ||
         m.short_name.toLowerCase().trim() === normalized
  );
  if (direct) return direct.raw_uid;

  // Aliases sheet lookup
  const aliasRows = await readRange("Aliases", "A2:D5000");
  for (const row of aliasRows) {
    if (row[2] && row[2].toLowerCase().trim() === normalized) {
      return String(row[1]);
    }
  }

  // Fuzzy — substring match
  const fuzzy = materials.find(m =>
    m.full_name.toLowerCase().includes(normalized.slice(0, 8)) ||
    normalized.includes(m.full_name.toLowerCase().slice(0, 8))
  );
  return fuzzy ? fuzzy.raw_uid : null;
}

export async function addAlias(raw_uid: string, alias: string, source: string): Promise<void> {
  const existing = await readRange("Aliases", "A2:D5000");
  const exists = existing.some(
    r => r[1] === raw_uid && r[2]?.toLowerCase() === alias.toLowerCase()
  );
  if (exists) return;
  const id = `AL_${Date.now()}`;
  await appendRows("Aliases", [[id, raw_uid, alias, source]]);
}

export async function addToReviewQueue(text: string, source_type: string, file_name: string): Promise<void> {
  const id = `RQ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await appendRows("ReviewQueue", [[id, text, source_type, file_name, "FALSE", new Date().toISOString()]]);
}

export async function getUnresolvedQueue(): Promise<any[]> {
  const rows = await readRange("ReviewQueue", "A2:F2000");
  return rows
    .filter(r => r[0] && String(r[4]).toUpperCase() !== "TRUE")
    .map(r => ({
      id: r[0],
      original_text: r[1],
      source_type: r[2],
      file_name: r[3],
      created_at: r[5],
    }));
}

export async function resolveQueueItem(queue_id: string): Promise<void> {
  const rows = await readRange("ReviewQueue", "A2:F2000");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === queue_id) {
      await writeRange("ReviewQueue", `E${i + 2}:E${i + 2}`, [["TRUE"]]);
      return;
    }
  }
}

// ─── PLANT STOCK ────────────────────────────────────────────────────────────

export async function writePlantStock(rows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[]): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  // Clear today's entries first to avoid duplicates
  const existing = await readRange("PlantStock", "A2:G5000");
  const keepRows = existing.filter(r => r[0] !== today);
  await clearRange("PlantStock", "A2:G5000");
  if (keepRows.length) await writeRange("PlantStock", `A2:G${keepRows.length + 1}`, keepRows);

  const newRows = rows.map(r => [today, r.raw_uid, r.name_from_source, r.qty, "кг", r.source_file, "FALSE"]);
  if (newRows.length) await appendRows("PlantStock", newRows);
}

export async function getLatestPlantStock(): Promise<Map<string, number>> {
  const rows = await readRange("PlantStock", "A2:G5000");
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r[1]) map.set(String(r[1]), parseFloat(r[3]) || 0);
  }
  return map;
}

// ─── LIP STOCK ──────────────────────────────────────────────────────────────

export async function writeLipStock(
  raw_uid: string, name_from_source: string,
  qty_on_hand: number, reserved_qty: number, free_qty: number, source: string
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const existing = await readRange("LipStock", "A2:I5000");
  const keepRows = existing.filter(r => !(r[0] === today && r[1] === raw_uid));
  await clearRange("LipStock", "A2:I5000");
  if (keepRows.length) await writeRange("LipStock", `A2:I${keepRows.length + 1}`, keepRows);
  const free = free_qty >= 0 ? free_qty : Math.max(0, qty_on_hand - reserved_qty);
  await appendRows("LipStock", [[today, raw_uid, name_from_source, qty_on_hand, reserved_qty, free, "кг", source, "FALSE"]]);
}

export async function getLatestLipStock(): Promise<Map<string, number>> {
  const rows = await readRange("LipStock", "A2:I5000");
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r[1]) {
      const free = parseFloat(r[5]) >= 0 ? parseFloat(r[5]) : Math.max(0, (parseFloat(r[3]) || 0) - (parseFloat(r[4]) || 0));
      map.set(String(r[1]), free);
    }
  }
  return map;
}

export async function getLipStockList(): Promise<any[]> {
  const rows = await readRange("LipStock", "A2:I5000");
  return rows.filter(r => r[0]).map(r => ({
    snapshot_date: r[0], raw_uid: r[1], name_from_source: r[2],
    qty_on_hand: parseFloat(r[3]) || 0, reserved_qty: parseFloat(r[4]) || 0,
    free_qty: parseFloat(r[5]) || 0, unit: r[6], source: r[7],
  }));
}

// ─── INBOUND ────────────────────────────────────────────────────────────────

export async function addInbound(
  raw_uid: string, raw_name: string, qty: number, eta: string, destination: string, document: string
): Promise<string> {
  const id = `IN_${Date.now()}`;
  await appendRows("Inbound", [[id, raw_uid, raw_name, qty, eta, destination, "в пути", document]]);
  return id;
}

export async function getInboundList(): Promise<any[]> {
  const rows = await readRange("Inbound", "A2:H5000");
  return rows.filter(r => r[0] && String(r[6]).toLowerCase() !== "получено").map(r => ({
    id: r[0], raw_uid: r[1], raw_name: r[2], qty: parseFloat(r[3]) || 0,
    eta: r[4], destination: r[5], status: r[6], document: r[7],
  }));
}

export async function updateInboundStatus(id: string, status: string): Promise<void> {
  const rows = await readRange("Inbound", "A2:H5000");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === id) {
      await writeRange("Inbound", `G${i + 2}:G${i + 2}`, [[status]]);
      return;
    }
  }
}

export async function deleteInbound(id: string): Promise<void> {
  await updateInboundStatus(id, "удалено");
}

export async function getInboundTotals(): Promise<Map<string, number>> {
  const rows = await readRange("Inbound", "A2:H5000");
  const map = new Map<string, number>();
  for (const r of rows) {
    const status = String(r[6] || "").toLowerCase();
    if (r[1] && status !== "получено" && status !== "удалено") {
      const cur = map.get(String(r[1])) || 0;
      map.set(String(r[1]), cur + (parseFloat(r[3]) || 0));
    }
  }
  return map;
}

// ─── NEED ────────────────────────────────────────────────────────────────────

export async function writeNeedFromRecipe(recipe_uid: string, lines: { raw_uid: string; net_qty: number }[]): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const version = new Date().toISOString();
  const newRows = lines
    .filter(l => l.raw_uid && l.net_qty > 0)
    .map(l => [`NEED_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, recipe_uid, l.raw_uid, period, l.net_qty, 0, l.net_qty, version]);
  if (newRows.length) await appendRows("Need", newRows);
}

export async function getNeedTotals(): Promise<Map<string, number>> {
  const rows = await readRange("Need", "A2:H5000");
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r[2]) {
      const cur = map.get(String(r[2])) || 0;
      map.set(String(r[2]), cur + (parseFloat(r[6]) || 0));
    }
  }
  return map;
}

// ─── RECIPES ────────────────────────────────────────────────────────────────

export async function writeRecipe(recipe: {
  code: string; full_name: string; premix_name: string; date: string;
  concentration: number; batch_t: number; customer: string; period: string;
  quarter: string; file_name: string; base_batch_kg: number;
}): Promise<string> {
  const uid = `REC_${Date.now()}`;
  await appendRows("Recipes", [[
    uid, recipe.code, recipe.full_name, recipe.premix_name, recipe.date,
    recipe.concentration, recipe.batch_t, recipe.customer, recipe.period,
    recipe.quarter, recipe.file_name, "активен", recipe.base_batch_kg
  ]]);
  return uid;
}

export async function writeRecipeLines(recipe_uid: string, lines: {
  raw_uid: string | null; name_from_recipe: string; activity: string;
  input_pct: number; norm_g_per_t: number; consumption_kg: number; match_status: string;
}[]): Promise<void> {
  const newRows = lines.map((l, i) => [
    `RL_${Date.now()}_${i}`, recipe_uid, l.raw_uid || "", l.name_from_recipe,
    l.activity, l.input_pct, l.norm_g_per_t, l.consumption_kg, 0, 0,
    "FALSE", l.match_status
  ]);
  if (newRows.length) await appendRows("RecipeLines", newRows);
}

export async function getRecipesList(): Promise<any[]> {
  const rows = await readRange("Recipes", "A2:M5000");
  return rows.filter(r => r[0]).map(r => ({
    recipe_uid: r[0], code: r[1], full_name: r[2], premix_name: r[3],
    date: r[4], batch_t: parseFloat(r[6]) || 0, customer: r[7], status: r[11],
    base_batch_kg: parseFloat(r[12]) || 1000,
  }));
}

// ─── APP LOG ────────────────────────────────────────────────────────────────

export async function log(level: string, message: string, detail: string = ""): Promise<void> {
  try {
    await appendRows("AppLog", [[new Date().toISOString(), level, message, detail]]);
  } catch {}
}

// ─── DECISIONS ──────────────────────────────────────────────────────────────

export async function computeDecisions() {
  const [materials, plantStock, lipStock, inboundTotals, needTotals] = await Promise.all([
    getAllRawMaterials(),
    getLatestPlantStock(),
    getLatestLipStock(),
    getInboundTotals(),
    getNeedTotals(),
  ]);

  const decisions = materials
    .filter(m => m.active)
    .map(m => {
      const plant_qty = plantStock.get(m.raw_uid) || 0;
      const lip_qty = lipStock.get(m.raw_uid) || 0;
      const inbound_qty = inboundTotals.get(m.raw_uid) || 0;
      const planned_need = needTotals.get(m.raw_uid) || 0;
      const threshold = m.avg_monthly_usage * m.reorder_threshold_factor;
      const available_total = plant_qty + lip_qty + inbound_qty;
      const expected_after_plan = available_total - planned_need;
      const deficit_to_threshold = Math.max(0, threshold - expected_after_plan);
      const cover_by_transfer = Math.min(lip_qty, deficit_to_threshold);
      const remaining_deficit = Math.max(0, deficit_to_threshold - cover_by_transfer);
      const cover_by_purchase = remaining_deficit;

      let status = "Норма";
      if (expected_after_plan < 0) status = "Срочно к закупке";
      else if (expected_after_plan < threshold) status = "К закупке";
      else if (expected_after_plan < m.avg_monthly_usage) status = "На контроле";

      return {
        raw_uid: m.raw_uid,
        name: m.full_name,
        avg_monthly_usage: m.avg_monthly_usage,
        threshold_qty: threshold,
        plant_qty,
        lip_qty,
        inbound_qty,
        planned_need,
        available_total,
        expected_after_plan,
        status,
        cover_by_transfer,
        cover_by_purchase,
      };
    });

  const statusOrder: Record<string, number> = {
    "Срочно к закупке": 0, "К закупке": 1, "На контроле": 2, "Норма": 3,
  };
  decisions.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));
  return decisions;
}
