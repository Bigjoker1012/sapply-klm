import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdtemp, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import pdfParse from 'pdf-parse';
import { parseRecipeWithVision } from './aiMatcher';
import { recipeFullName } from './excelParser';

const execFileAsync = promisify(execFile);

export interface ParsedRow {
  rawName: string;
  quantity: number;
}

export interface RecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
  // Цена за 1 кг: >0 → наша позиция (закупка/списание); 0 → позиция завода
  // (исключаем); null → цена неизвестна (источник без колонки цены) → трактуем
  // как нашу, чтобы не потерять позицию.
  pricePerKg: number | null;
  // «Расход сырья, кг» с учтёнными мех. потерями (есть в Excel-рецептах; в PDF —
  // обычно отсутствует). Приоритетный источник списания, см. routes/upload.ts.
  consumptionKg?: number;
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

// ─── Recipe PDF — текстовый слой (цифровые PDF) ───────────────────────────────

/** Русское число: «3 208,16» → 3208.16 (пробел — тысячи, запятая — десятичная). */
function parseRuNum(s: string): number {
  const v = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return isNaN(v) ? 0 : v;
}

// Строка компонента: «НАИМЕНИЕ  40,102 %  3 208,16 ...» — имя, % ввода, кол-во кг.
const RECIPE_COMP_RE = /^(.+?)\s+(\d[\d ]*[.,]?\d*)\s*%\s+([\d ]+[.,]\d+)/;

/**
 * Парсинг рецепта из текстового слоя PDF (цифровые рецепты Полоцкого КХП).
 * Компоненты идут до раздела «Показатели качества». Возвращает null, если
 * подходящих строк не найдено (тогда вызывающий код уходит в OCR-фолбэк).
 */
function parseRecipeFromText(text: string): ParsedRecipe | null {
  const lines = text.split("\n");

  let code = "";
  let name = "";
  let date = "";
  let batchKg = 0;

  for (const raw of lines.slice(0, 40)) {
    const line = raw.trim();
    if (!line) continue;
    // Строка-код вида «КК-61-1 С-к Б20 ПЛЦ-0» / «Д-П60-3 Б20 ПЛЦ8».
    if (!code && /ПЛЦ[-\s]?\d/i.test(line) && line.length < 40 && /^[A-Za-zА-ЯЁа-яё]/.test(line)) {
      code = line;
    }
    if (!date) {
      const m = line.match(/(\d{2}[.\-/]\d{2}[.\-/]\d{4})/);
      if (m) date = m[1];
    }
    if (!batchKg) {
      // \b не работает после кириллической «т», поэтому без границы слова.
      const m = line.match(/Выработка[:\s]*(\d[\d.,\s]*?)\s*т/i);
      if (m) batchKg = parseRuNum(m[1]) * 1000;
    }
    if (!name) {
      const m = line.match(/^Для\s+(.+)$/i);
      if (m) name = m[1].trim();
    }
  }

  const rows: RecipeRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/Показатели\s+качества/i.test(line)) break; // дальше — показатели, не сырьё
    const m = line.match(RECIPE_COMP_RE);
    if (!m) continue;
    const rawName = m[1].trim();
    if (rawName.length < 2) continue;
    if (/^(состав|в рецепте)/i.test(rawName)) continue;
    const percentage = parseRuNum(m[2]);
    const quantityPerTon = parseRuNum(m[3]);
    if (percentage <= 0) continue;
    // Текстовый слой не даёт надёжно колонку цены — цена неизвестна (null →
    // трактуем как нашу позицию, чтобы не потерять её).
    rows.push({ rawName, percentage, quantityPerTon, pricePerKg: null });
  }

  if (rows.length === 0) return null;

  return {
    name: name || recipeFullName(code) || "Рецепт",
    code,
    date: date || new Date().toISOString().split("T")[0],
    batchKg: batchKg || 1000,
    rows,
  };
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

/**
 * Рендер первых страниц PDF в PNG (poppler pdftoppm) и возврат base64.
 * Нужно для vision-парсинга PDF без текстового слоя.
 */
async function renderPdfToPngs(buffer: Buffer, maxPages = 2): Promise<string[]> {
  // Уникальная директория на запрос (mkdtemp), чтобы исключить коллизии имён
  // при параллельных загрузках и гарантированно удалить ВСЕ артефакты рендера.
  const dir = await mkdtemp(join(tmpdir(), 'klm_recipe_'));
  const pdfPath = join(dir, 'in.pdf');
  await writeFile(pdfPath, buffer);
  try {
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', '200', '-f', '1', '-l', String(maxPages), pdfPath, join(dir, 'page')],
      { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }
    );
    // Читаем все сгенерированные PNG по содержимому каталога (имена нумеруются
    // по-разному в зависимости от числа страниц), в стабильном порядке.
    const files = (await readdir(dir))
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort();
    const pngs: string[] = [];
    for (const f of files) {
      const b = await readFile(join(dir, f));
      pngs.push(b.toString('base64'));
    }
    return pngs;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function parseRecipePdf(buffer: Buffer): Promise<ParsedRecipe> {
  // 1) Цифровые PDF: парсим текстовый слой напрямую (быстро, без OCR/MuPDF).
  try {
    const data = await pdfParse(buffer);
    const fromText = parseRecipeFromText(data.text);
    if (fromText && fromText.rows.length > 0) return fromText;
  } catch (e) {
    console.warn("[recipe] текстовый слой недоступен, пробую vision:", (e as Error)?.message);
  }

  // 2) Нет текстового слоя (текст вшит кривыми, частый случай 1С-премиксов):
  //    рендерим страницу в картинку и читаем таблицу vision-моделью. Это
  //    надёжнее tesseract на плотной многоколоночной таблице. Любой сбой
  //    (нет ключа OpenAI, ошибка сети, пустой результат) → tesseract-фолбэк.
  try {
    const pngs = await renderPdfToPngs(buffer, 2);
    console.log(`[recipe] vision: отрендерено страниц=${pngs.length}, ключ OpenAI=${process.env.OPENAI_API_KEY ? "есть" : "НЕТ"}`);
    if (pngs.length) {
      const ai = await parseRecipeWithVision(pngs);
      console.log(`[recipe] vision: строк распознано=${ai?.rows.length ?? 0}`);
      if (ai && ai.rows.length > 0) {
        return {
          name: ai.name,
          code: ai.code,
          date: ai.date,
          batchKg: ai.batchKg,
          rows: ai.rows.map(r => ({
            rawName: r.rawName,
            percentage: r.percentage,
            quantityPerTon: r.quantityPerTon,
            pricePerKg: r.pricePerKg,
          })),
        };
      }
    }
  } catch (e) {
    console.error("[recipe] vision-разбор не удался, пробую OCR:", (e as Error)?.message || e);
  }

  // 3) Сканы / запасной путь: рендер страницы в изображение + tesseract.
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
      // OCR не даёт надёжно цену — неизвестно (null → трактуем как нашу).
      pricePerKg: r.pricePerKg == null ? null : Number(r.pricePerKg) || 0,
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
