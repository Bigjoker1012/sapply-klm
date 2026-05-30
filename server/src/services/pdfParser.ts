import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import pdfParse from 'pdf-parse';

const execFileAsync = promisify(execFile);

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
}

export interface ParsedRecipe {
  name: string;
  code: string;
  date: string;
  batchKg: number;
  rows: RecipeRow[];
}

// ─── Warehouse PDF (fallback — scanned PDFs use excelParser instead) ──────────

export async function parsePolotskPdf(buffer: Buffer): Promise<ParsedRow[]> {
  const data = await pdfParse(buffer);
  const lines = data.text.split('\n').map((l: string) => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];

  for (const line of lines) {
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

// ─── Recipe PDF via OCR (tesseract 5.5) ───────────────────────────────────────

/**
 * Резолвим путь к Python-скрипту OCR устойчиво к режиму запуска (ts-node из
 * src vs node из dist). tsc не копирует .py в dist, поэтому `__dirname` после
 * сборки указывает в dist/.../services, где скрипта нет. Стратегия:
 *   1) `__dirname/ocr_recipe.py` — работает в dev/ts-node;
 *   2) `process.cwd()/server/src/services/ocr_recipe.py` — работает из dist
 *      (репо целиком есть в деплое, запуск всегда из корня).
 * Первый существующий путь — выигрывает.
 */
function resolveOcrScript(): string {
  const candidates = [
    join(__dirname, 'ocr_recipe.py'),
    resolve(process.cwd(), 'server/src/services/ocr_recipe.py'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Возвращаем первый кандидат — execFile отдаст понятную ошибку с путём.
  return candidates[0];
}

const OCR_SCRIPT = resolveOcrScript();

export async function parseRecipePdf(buffer: Buffer): Promise<ParsedRecipe> {
  const tmpFile = join(tmpdir(), `klm_recipe_${Date.now()}.pdf`);
  try {
    await writeFile(tmpFile, buffer);

    const { stdout, stderr } = await execFileAsync(
      'python3',
      [OCR_SCRIPT, tmpFile],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );

    if (!stdout.trim()) {
      throw new Error(`OCR script returned empty output. stderr: ${stderr?.slice(0, 300)}`);
    }

    const parsed = JSON.parse(stdout);

    if (parsed.error) {
      throw new Error(`OCR error: ${parsed.error}`);
    }

    const rows: RecipeRow[] = (parsed.rows || []).map((r: any) => ({
      rawName: r.rawName,
      percentage: Number(r.percentage) || 0,
      quantityPerTon: Number(r.quantityKg) || 0,
    }));

    return {
      name: parsed.name || parsed.code || 'Рецепт',
      code: parsed.code || '',
      date: parsed.date || new Date().toISOString().split('T')[0],
      batchKg: Number(parsed.batchKg) || 1000,
      rows,
    };
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}
