import * as XLSX from "xlsx";

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

/**
 * Парсинг квартального Excel остатков Полоцка КХП.
 * Структура: данные начинаются с 9-й строки (индекс 8), столбец B (индекс 1) = название сырья.
 * Последний непустой числовой столбец в строке = текущий остаток.
 */
export function parsePolotskExcel(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const result: ParsedRow[] = [];
  const skipWords = ["сырье", "дата", "выработка", "наименование", "итого", "план"];

  for (let r = 8; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[1]) continue;

    const rawName = String(row[1]).trim();
    if (rawName.length < 2) continue;
    if (skipWords.some(w => rawName.toLowerCase().includes(w))) continue;
    if (/^\d/.test(rawName)) continue; // starts with number — skip header rows

    // Find the last numeric value in the row (rightmost non-null column starting from column 2)
    let qty = 0;
    let found = false;
    for (let c = Math.min(row.length - 1, 30); c >= 2; c--) {
      const v = row[c];
      if (v !== null && v !== undefined && v !== "") {
        const s = String(v).replace(/\s/g, "").replace(",", ".");
        const n = parseFloat(s);
        if (!isNaN(n) && n >= 0) {
          qty = n;
          found = true;
          break;
        }
      }
    }

    if (!found) continue;
    result.push({ rawName, quantity: qty });
  }

  return result;
}

export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

/**
 * Парсинг Excel рецепта.
 */
export function parseRecipeExcel(buffer: Buffer): {
  name: string; code: string; date: string; rows: RecipeRow[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const headers = (rows[0] || []).map((h: any) => String(h).toLowerCase().trim());
  let nameIdx = headers.findIndex((h: string) =>
    h.includes("наим") || h.includes("компон") || h.includes("сырь"));
  let pctIdx = headers.findIndex((h: string) =>
    h.includes("%") || h.includes("проц") || h.includes("ввод"));
  let qtyIdx = headers.findIndex((h: string) =>
    h.includes("г/т") || h.includes("норм") || h.includes("расход"));

  if (nameIdx === -1) nameIdx = 0;
  if (pctIdx === -1) pctIdx = 1;
  if (qtyIdx === -1) qtyIdx = 2;

  const recipeRows: RecipeRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] || "").trim();
    if (!name || name.length < 2) continue;
    const pct = parseFloat(String(row[pctIdx] || "").replace(",", ".")) || 0;
    const qty = parseFloat(String(row[qtyIdx] || "").replace(",", ".")) || 0;
    if (!pct && !qty) continue;
    recipeRows.push({ rawName: name, percentage: pct, quantityPerTon: qty });
  }

  return {
    name: String(rows[0]?.[0] || "Рецепт"),
    code: "",
    date: new Date().toISOString().split("T")[0],
    rows: recipeRows,
  };
}
