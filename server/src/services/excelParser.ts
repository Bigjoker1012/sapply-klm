import * as XLSX from 'xlsx';

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

/**
 * Парсинг Excel остатков Полоцка.
 * Ищет колонки с наименованием и количеством.
 */
export function parsePolotskExcel(buffer: Buffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // Ищем заголовки
  const headers = rows[0].map((h: any) => String(h).toLowerCase().trim());
  let nameIdx = -1;
  let qtyIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    if (nameIdx === -1 && (headers[i].includes('наим') || headers[i].includes('name') || headers[i].includes('сырь'))) nameIdx = i;
    if (qtyIdx === -1 && (headers[i].includes('кол') || headers[i].includes('qty') || headers[i].includes('остат') || headers[i].includes('кг'))) qtyIdx = i;
  }

  // Если заголовки не найдены — предположим col 0 = name, col 1 = qty
  if (nameIdx === -1) nameIdx = 0;
  if (qtyIdx === -1) qtyIdx = 1;

  const result: ParsedRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] || '').trim();
    const qtyRaw = row[qtyIdx];
    const qty = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw).replace(',', '.'));
    if (!name || isNaN(qty)) continue;
    result.push({ rawName: name, quantity: qty });
  }

  return result;
}

/**
 * Парсинг Excel рецепта.
 */
export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

export function parseRecipeExcel(buffer: Buffer): { name: string; code: string; date: string; rows: RecipeRow[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const headers = (rows[0] || []).map((h: any) => String(h).toLowerCase().trim());
  let nameIdx = headers.findIndex((h: string) => h.includes('наим') || h.includes('компон'));
  let pctIdx = headers.findIndex((h: string) => h.includes('%') || h.includes('проц') || h.includes('ввод'));
  let qtyIdx = headers.findIndex((h: string) => h.includes('г/т') || h.includes('кг') || h.includes('норм'));

  if (nameIdx === -1) nameIdx = 0;
  if (pctIdx === -1) pctIdx = 1;
  if (qtyIdx === -1) qtyIdx = 2;

  const recipeRows: RecipeRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameIdx] || '').trim();
    const pct = parseFloat(String(row[pctIdx]).replace(',', '.'));
    const qty = parseFloat(String(row[qtyIdx]).replace(',', '.'));
    if (!name || isNaN(pct)) continue;
    recipeRows.push({ rawName: name, percentage: pct, quantityPerTon: isNaN(qty) ? 0 : qty });
  }

  return {
    name: String(rows[0]?.[0] || 'Рецепт'),
    code: '',
    date: new Date().toISOString().split('T')[0],
    rows: recipeRows
  };
}
