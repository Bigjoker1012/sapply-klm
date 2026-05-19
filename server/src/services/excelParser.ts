import * as XLSX from "xlsx";

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

/**
 * Парсинг "Складского отчёта № ЗПП-37" от кладовщика Полоцка.
 * Формат: col A = наименование + номер партии (К111-26), col E = остаток на конец дня.
 * Несколько партий одного сырья суммируются.
 */
export function parsePolotskExcel(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const SKIP_STARTS = [
    "итого", "начальник", "бухгалтер", "мастер", "наименование",
    "хлебопродуктов", "склад", "оао", "утвержд", "министер",
    "и продо", "код по", "отраслев", "с к л", "о движ",
    "клм давальч", "премиксы клм", "за ", "Материально",
  ];

  const aggregated = new Map<string, number>();
  let dateStr = "";

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    // Detect date: column B contains "за __ мая 2026 года"
    const c1 = String(row[1] || "").trim().toLowerCase();
    if (!dateStr && c1.startsWith("за ") && /20\d\d/.test(c1)) {
      dateStr = String(row[1] || "").trim();
    }

    const c0Raw = String(row[0] || "").trim();
    if (!c0Raw) continue;

    // Skip header / signature / section-marker rows
    const c0Low = c0Raw.toLowerCase();
    if (SKIP_STARTS.some(s => c0Low.startsWith(s.toLowerCase()))) continue;
    if (/^\s*\d+\s*$/.test(c0Raw)) continue; // pure number

    // Column E (index 4) = остаток на конец дня
    const c4 = row[4];
    if (c4 == null || c4 === "" || c4 === 0) continue;
    const qty = parseFloat(String(c4).replace(/\s/g, "").replace(",", "."));
    if (isNaN(qty) || qty <= 0) continue;

    // Clean material name: strip batch code like "К111-26", "К31", " 179-26"
    let name = c0Raw
      .replace(/\s+К?\d{1,5}[-\d]*\s*$/, "")   // trailing К###-## or К##
      .replace(/\s{2,}/g, " ")
      .trim();
    if (name.length < 2) continue;

    // Aggregate by cleaned name
    aggregated.set(name, (aggregated.get(name) || 0) + qty);
  }

  return Array.from(aggregated.entries()).map(([rawName, quantity]) => ({ rawName, quantity }));
}

/**
 * Парсинг Excel рецепта технолога.
 * Ищет строки: наименование компонента | активность % | ввод % | г/т | кг на партию
 */
export function parseRecipeExcel(buffer: Buffer): {
  name: string; code: string; date: string; rows: RecipeRow[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Find recipe name and code in first rows
  let recipeName = "";
  let recipeCode = "";
  let recipeDate = new Date().toISOString().split("T")[0];

  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const line = rows[r].map((v: any) => String(v || "").trim()).join(" ").trim();
    if (!recipeName && line.length > 4 && !/^\d/.test(line)) recipeName = line.slice(0, 120);
    const codeMatch = line.match(/\b(Д-[А-ЯA-Z\d-]+|ПЛЦ[-\d]+|REC[-\d]+)/i);
    if (!recipeCode && codeMatch) recipeCode = codeMatch[1];
    const dateMatch = line.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})/);
    if (dateMatch) recipeDate = dateMatch[1];
  }

  // Find header row
  let headerRow = -1;
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const cells = rows[r].map((v: any) => String(v || "").toLowerCase());
    if (cells.some(c => c.includes("наим") || c.includes("компон"))) {
      headerRow = r;
      break;
    }
  }

  const headers = headerRow >= 0
    ? rows[headerRow].map((v: any) => String(v || "").toLowerCase())
    : [];

  let nameIdx = headers.findIndex((h: string) => h.includes("наим") || h.includes("компон") || h.includes("сырь"));
  let pctIdx  = headers.findIndex((h: string) => h.includes("%") || h.includes("ввод") || h.includes("проц"));
  let qtyIdx  = headers.findIndex((h: string) => h.includes("г/т") || h.includes("норм") || h.includes("расход") || h.includes("кг"));
  if (nameIdx < 0) nameIdx = 1;
  if (pctIdx  < 0) pctIdx  = 3;
  if (qtyIdx  < 0) qtyIdx  = 4;

  const startRow = headerRow >= 0 ? headerRow + 1 : 8;
  const recipeRows: RecipeRow[] = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] || "").trim();
    if (!name || name.length < 2) continue;
    if (/^итого|^всего|^total/i.test(name)) continue;

    const pct = parseFloat(String(row[pctIdx] || "").replace(",", ".")) || 0;
    const qty = parseFloat(String(row[qtyIdx] || "").replace(",", ".")) || 0;
    if (!pct && !qty) continue;

    recipeRows.push({ rawName: name, percentage: pct, quantityPerTon: qty });
  }

  return {
    name: recipeName || "Рецепт",
    code: recipeCode,
    date: recipeDate,
    rows: recipeRows,
  };
}
