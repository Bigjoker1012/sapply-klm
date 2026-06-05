import * as XLSX from "xlsx";

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

export interface KdRow {
  vendorName: string;  // full string as in КД ("Актиген мешок 25 кг. партия IE002856")
  baseName: string;    // base without batch suffix ("Актиген мешок 25 кг.")
  batchCode: string;   // "IE002856" or ""
  qty: number;         // конечный остаток
}

const KD_BATCH_RE = /\s*,?\s*партия\s+(\S+)\s*$/i;

const KD_SKIP_RE = /^(склад|номенклатура|итог|период|показат|группир|отбор|доп|ведомость)/i;

// Дата в колонках «Дата поставки»/«Срок годности» (ДД.ММ.ГГ) — признак строки
// серии (партии), а не номенклатуры.
const KD_DATE_RE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;

/**
 * Строка документа движения (регистратора) в выгрузке 1С дублирует текст через
 * запятую: «Перемещение товаров ..., Перемещение товаров ...» или пустая «, ».
 * Такие строки не являются номенклатурой и должны отбрасываться.
 */
function isKdDocRow(value: string): boolean {
  const t = value.trim();
  if (t === ",") return true;
  const m = t.match(/^(.+?),\s*(.+)$/);
  return !!(m && m[1].trim() === m[2].trim());
}

export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

/**
 * Парсинг КД "Ведомость по партиям товаров на складах" (Липковская/1С).
 *
 * Поддерживает два варианта выгрузки 1С:
 *   • «широкий» — раздельные колонки Количество/Стоимость, «Конечный остаток
 *     (количество)» в col H (index 7);
 *   • «по партиям» — col A = наименование, col B/C = Дата поставки/Срок годности,
 *     «Конечный остаток» в col G (index 6), под номенклатурой — строки серий
 *     (с датами) и документов движения.
 *
 * Колонка конечного остатка ищется динамически по ячейке-заголовку «Конечный
 * остаток» (fallback — index 7). Берём только строки уровня номенклатуры:
 * отбрасываем строки серий (даты в col B/C) и строки документов движения
 * (дублирование «X, X»). Наименование — col A (index 0). Числа формата 1,500.000
 * (запятая — разделитель тысяч) приводятся к числу.
 */
export function parseKdExcel(buffer: Buffer): KdRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Динамический поиск колонки «Конечный остаток» по строке-заголовку.
  // Сравниваем ячейку целиком (не подстрокой) — иначе совпадёт описательная
  // строка «Показатели: ...Конечный остаток(Количество);...».
  let qtyCol = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      // Заголовок-ячейка вида «Конечный остаток» / «Конечный остаток (количество)».
      // Описательная строка «Показатели: ...» начинается с «Показатели», поэтому
      // под якорь ^ не попадает.
      if (/^конечный остаток/i.test(String(row[c] || "").trim())) {
        qtyCol = c;
        break;
      }
    }
    if (qtyCol >= 0) break;
  }
  if (qtyCol < 0) qtyCol = 7;

  const results: KdRow[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const vendorName = String(row[0] || "").trim();
    if (!vendorName || vendorName.length < 3) continue;
    if (KD_SKIP_RE.test(vendorName)) continue;
    // Пропускаем чисто числовые ячейки (1500, 6 799, 1,500.000 и т.п.) — это
    // суммы/количества, ошибочно попавшие в колонку наименования, а не сырьё.
    if (/^[\d\s.,]+$/.test(vendorName)) continue;
    // Строки серий (партий) содержат даты в col B/C — это не номенклатура.
    if (KD_DATE_RE.test(String(row[1] || "").trim()) ||
        KD_DATE_RE.test(String(row[2] || "").trim())) continue;
    // Строки документа движения дублируют текст «X, X» — отбрасываем.
    if (isKdDocRow(vendorName)) continue;

    const qtyRaw = row[qtyCol];
    if (qtyRaw == null || qtyRaw === "") continue;
    const qty = typeof qtyRaw === "number"
      ? qtyRaw
      : parseFloat(String(qtyRaw).replace(/[\s,]/g, ""));
    if (isNaN(qty) || qty <= 0) continue;

    // Extract batch code from trailing "партия XXXXX"
    const batchMatch = vendorName.match(KD_BATCH_RE);
    const batchCode = batchMatch ? batchMatch[1] : "";
    const baseName = batchMatch
      ? vendorName.slice(0, vendorName.length - batchMatch[0].length).trim()
      : vendorName;

    results.push({ vendorName, baseName, batchCode, qty });
  }

  return results;
}

/**
 * Парсинг складских остатков — поддерживает два формата:
 *
 * Формат А — ЗПП-37 (Липковская/кладовщик):
 *   col A = наименование + номер партии (К111-26), col E = остаток на конец дня.
 *
 * Формат Б — "Расход сырья" (Полоцк, плановая таблица):
 *   col B (idx 1) = наименование, col I (idx 8) = остаток на отчётную дату.
 *
 * Автоопределение формата: если в первых 10 строках col B содержит текст
 * длиннее 3 символов и col I — число, используем Формат Б.
 * Несколько партий одного сырья суммируются (актуально для ЗПП-37).
 */
export function parsePolotskExcel(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const aggregated = new Map<string, number>();

  // ── Формат Б: многолистовой "Расход сырья" Полоцка ───────────────────────
  // Ищем лист с "_квартал" в имени, у которого в col I есть ненулевые данные.
  // Col B = название сырья, Col I (idx 8) = остаток на отчётную дату.
  const kvartalSheet = wb.SheetNames.find((n: string) => {
    if (!/_квартал/i.test(n)) return false;
    const s = wb.Sheets[n];
    const rs: any[][] = XLSX.utils.sheet_to_json(s, { header: 1, defval: null });
    return rs.some((r: any[]) => {
      const b = String(r[1] || "").trim();
      const iVal = r[8];
      return b.length > 3 && !b.match(/^[0-9]/) &&
             iVal != null && parseFloat(String(iVal)) > 0;
    });
  });

  if (kvartalSheet) {
    const kWs = wb.Sheets[kvartalSheet];
    const kRows: any[][] = XLSX.utils.sheet_to_json(kWs, { header: 1, defval: null });
    const SKIP_B = ["итого", "всего", "наименование", "сырье", "дата", "номер", "№",
                    "число", "выраб", "постав", "планир", "перевезти", "отр.", "срочно"];
    for (const row of kRows) {
      if (!row) continue;
      const nameRaw = String(row[1] || "").trim();
      if (!nameRaw || nameRaw.length < 2) continue;
      const nameLow = nameRaw.toLowerCase();
      if (SKIP_B.some(s => nameLow.startsWith(s))) continue;
      const iVal = row[8];
      if (iVal == null || iVal === "" || iVal === 0) continue;
      const qty = parseFloat(String(iVal).replace(/\s/g, "").replace(",", "."));
      if (isNaN(qty) || qty <= 0) continue;
      const name = nameRaw.replace(/\s{2,}/g, " ").trim();
      aggregated.set(name, (aggregated.get(name) || 0) + qty);
    }
  } else {
    // ── Формат А: ЗПП-37 (col A = name, col E = остаток) ────────────────
    const SKIP_STARTS = [
      "итого", "начальник", "бухгалтер", "мастер", "наименование",
      "хлебопродуктов", "склад", "оао", "утвержд", "министер",
      "и продо", "код по", "отраслев", "с к л", "о движ",
      "клм давальч", "премиксы клм", "за ", "Материально",
    ];
    let dateStr = "";
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const c1 = String(row[1] || "").trim().toLowerCase();
      if (!dateStr && c1.startsWith("за ") && /20\d\d/.test(c1)) {
        dateStr = String(row[1] || "").trim();
      }
      const c0Raw = String(row[0] || "").trim();
      if (!c0Raw) continue;
      const c0Low = c0Raw.toLowerCase();
      if (SKIP_STARTS.some(s => c0Low.startsWith(s.toLowerCase()))) continue;
      if (/^\s*\d+\s*$/.test(c0Raw)) continue;
      const c4 = row[4];
      if (c4 == null || c4 === "" || c4 === 0) continue;
      const qty = parseFloat(String(c4).replace(/\s/g, "").replace(",", "."));
      if (isNaN(qty) || qty <= 0) continue;
      let name = c0Raw
        .replace(/\s+К?\d{1,5}[-\d]*\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (name.length < 2) continue;
      aggregated.set(name, (aggregated.get(name) || 0) + qty);
    }
  }

  return Array.from(aggregated.entries()).map(([rawName, quantity]) => ({ rawName, quantity }));
}

/**
 * Парсинг Excel рецепта технолога.
 * Ищет строки: наименование компонента | активность % | ввод % | г/т | кг на партию
 */
export function parseRecipeExcel(buffer: Buffer): {
  name: string; code: string; date: string; batchKg: number; rows: RecipeRow[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // Find recipe name and code in first rows
  let recipeName = "";
  let recipeCode = "";
  let recipeDate = new Date().toISOString().split("T")[0];
  let batchKg = 0; // выработка (объём заказа) из шапки рецепта, кг

  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const line = rows[r].map((v: any) => String(v || "").trim()).join(" ").trim();
    if (!recipeName && line.length > 4 && !/^\d/.test(line)) recipeName = line.slice(0, 120);
    const codeMatch = line.match(/\b(Д-[А-ЯA-Z\d-]+|ПЛЦ[-\d]+|REC[-\d]+)/i);
    if (!recipeCode && codeMatch) recipeCode = codeMatch[1];
    const dateMatch = line.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})/);
    if (dateMatch) recipeDate = dateMatch[1];
    if (!batchKg) {
      // «Выработка: N т» → кг. Норма сырья в рецепте дана на 1 т, выработка
      // масштабирует потребность/списание (см. routes/upload.ts).
      const bm = line.match(/Выработк[аи][:\s]*([\d.,\s]+?)\s*т/i);
      if (bm) {
        const t = parseFloat(bm[1].replace(/\s/g, "").replace(",", "."));
        if (Number.isFinite(t) && t > 0) batchKg = t * 1000;
      }
    }
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
    batchKg: batchKg || 1000,
    rows: recipeRows,
  };
}
