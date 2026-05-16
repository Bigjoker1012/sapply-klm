import pdfParse from 'pdf-parse';

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

/**
 * Парсинг PDF остатков Полоцка.
 * Ищет строки вида: "Витамин А 1000   111.6 кг"
 */
export async function parsePolotskPdf(buffer: Buffer): Promise<ParsedRow[]> {
  const data = await pdfParse(buffer);
  const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];

  for (const line of lines) {
    // Паттерн: название + число (с точкой или запятой)
    const match = line.match(/^(.+?)\s+([\d\s.,]+)\s*(кг|kg)?$/i);
    if (!match) continue;
    const name = match[1].trim();
    const qtyStr = match[2].replace(/\s/g, '').replace(',', '.');
    const qty = parseFloat(qtyStr);
    if (isNaN(qty) || qty < 0) continue;
    if (name.length < 2) continue;
    rows.push({ rawName: name, quantity: qty });
  }

  return rows;
}

/**
 * Парсинг PDF рецепта.
 * Ищет строки с % вводом и наименованием компонента.
 */
export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

export async function parseRecipePdf(buffer: Buffer): Promise<{ name: string; code: string; date: string; rows: RecipeRow[] }> {
  const data = await pdfParse(buffer);
  const text = data.text;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let recipeName = '';
  let recipeCode = '';
  let recipeDate = '';
  const rows: RecipeRow[] = [];

  for (const line of lines) {
    // Дата
    if (!recipeDate) {
      const dateMatch = line.match(/(\d{2}[.\-\/]\d{2}[.\-\/]\d{2,4})/);
      if (dateMatch) recipeDate = dateMatch[1];
    }
    // Код рецепта (ПЛЦ, PLT, REC и т.п.)
    if (!recipeCode) {
      const codeMatch = line.match(/\b(ПЛЦ|PLT|REC|RM)[- ]?[\d]+/i);
      if (codeMatch) recipeCode = codeMatch[0];
    }
    // Строка компонента: название % количество
    const compMatch = line.match(/^(.+?)\s+([\d.,]+)\s*%?\s+([\d.,]+)/);
    if (compMatch) {
      const name = compMatch[1].trim();
      const pct = parseFloat(compMatch[2].replace(',', '.'));
      const qty = parseFloat(compMatch[3].replace(',', '.'));
      if (!isNaN(pct) && !isNaN(qty) && name.length > 1) {
        rows.push({ rawName: name, percentage: pct, quantityPerTon: qty });
      }
    }
  }

  // Название рецепта — первая длинная строка
  recipeName = lines.find(l => l.length > 5 && !/^\d/.test(l)) || 'Рецепт';

  return {
    name: recipeName,
    code: recipeCode,
    date: recipeDate || new Date().toISOString().split('T')[0],
    rows
  };
}
