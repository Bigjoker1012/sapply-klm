import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, mkdtemp, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import pdfParse from 'pdf-parse';
import { recipeFullName } from './excelParser';
import https from 'https';

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
/**
 * Резолвим Python: venv с pymupdf → системный python3.
 * На сервере pymupdf установлен в /opt/sapply-klm/pdf-venv/,
 * локально может быть глобально.
 */
function resolvePython(): string {
  const venvPy = '/opt/sapply-klm/pdf-venv/bin/python3';
  if (existsSync(venvPy)) return venvPy;
  return 'python3';
}

const PYTHON = resolvePython();

function resolveOcrScript(): string {
  const candidates = [
    resolve(process.cwd(), 'server/scripts/parse_recipe.py'),
    join(__dirname, 'ocr_recipe.py'),
    resolve(process.cwd(), 'server/src/services/ocr_recipe.py'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const OCR_SCRIPT = resolveOcrScript();

/**
 * Рендер первой страницы PDF в PNG через pymupdf (venv) и возврат base64.
 * Заменяет pdftoppm (не установлен на сервере).
 */
async function renderPdfToPngVenv(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'klm_recipe_'));
  const pdfPath = join(dir, 'in.pdf');
  await writeFile(pdfPath, buffer);
  try {
    const { stdout } = await execFileAsync(
      PYTHON,
      ['-c', `
import fitz, base64
doc = fitz.open("${pdfPath.replace(/\\/g, '\\\\')}")
page = doc[0]
pix = page.get_pixmap(dpi=200)
print(base64.b64encode(pix.tobytes("png")).decode())
doc.close()
`],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    return stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * MiMo API vision: отправляет PNG base64 и возвращает JSON с ингредиентами.
 */
async function parseRecipeWithMiMoVision(imageBase64: string): Promise<ParsedRecipe | null> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    console.log('[recipe] MiMo vision: MIMO_API_KEY не задан, пропускаю');
    return null;
  }

  const prompt = `Extract ALL ingredients from this feed recipe. Return ONLY valid JSON, no markdown:
{"recipe_code":"...","recipe_name":"...","date":"...","batch_t":number,"concentration_pct":number,"ingredients":[{"code":"...","name":"...","percentage":number,"quantity_kg":number,"norm_g_per_t":number}]}`;

  const body = JSON.stringify({
    model: 'mimo-v2.5',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    }],
    max_tokens: 8192,
  });

  return new Promise((resolve) => {
    const url = new URL(process.env.MIMO_API_URL || 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.error('[recipe] MiMo vision API error:', json.error.message || json.error);
            resolve(null);
            return;
          }
          let content = json.choices?.[0]?.message?.content || '';
          // Strip markdown code fences
          if (content.includes('```')) {
            const parts = content.split('```');
            content = parts[1] || '';
            if (content.startsWith('json')) content = content.slice(4);
          }
          const parsed = JSON.parse(content.trim());
          const rows: RecipeRow[] = (parsed.ingredients || []).map((r: any) => ({
            rawName: r.name || r.code || '',
            percentage: Number(r.percentage) || 0,
            quantityPerTon: Number(r.quantity_kg) || 0,
            pricePerKg: null,
          }));
          console.log(`[recipe] MiMo vision: rows=${rows.length}, code=${parsed.recipe_code}`);
          resolve({
            name: parsed.recipe_name || parsed.recipe_code || 'Рецепт',
            code: parsed.recipe_code || '',
            date: parsed.date || new Date().toISOString().split('T')[0],
            batchKg: Number(parsed.batch_t) ? Number(parsed.batch_t) * 1000 : 1000,
            rows,
          });
        } catch (e) {
          console.error('[recipe] MiMo vision parse error:', (e as Error)?.message);
          resolve(null);
        }
      });
    });
    req.on('error', (e) => {
      console.error('[recipe] MiMo vision request error:', e.message);
      resolve(null);
    });
    req.on('timeout', () => {
      console.error('[recipe] MiMo vision timeout');
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
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

  // 2) Нет текстового слоя — MiMo API vision (pymupdf → PNG → mimo-v2.5).
  //    Сбой (нет ключа, ошибка сети, пустой результат) → tesseract-фолбэк.
  try {
    console.log('[recipe] MiMo vision: рендерю PDF в PNG через pymupdf...');
    const pngBase64 = await renderPdfToPngVenv(buffer);
    console.log(`[recipe] MiMo vision: PNG готов, size=${pngBase64.length} chars`);
    const ai = await parseRecipeWithMiMoVision(pngBase64);
    if (ai && ai.rows.length > 0) {
      console.log(`[recipe] MiMo vision: строк распознано=${ai.rows.length}`);
      return ai;
    }
    console.log('[recipe] MiMo vision: 0 строк, fallback на tesseract');
  } catch (e) {
    console.error("[recipe] MiMo vision не удался, пробую OCR:", (e as Error)?.message || e);
  }

  // 3) Сканы / запасной путь: рендер страницы в изображение + tesseract.
  const tmpFile = join(tmpdir(), `klm_recipe_${Date.now()}.pdf`);
  try {
    await writeFile(tmpFile, buffer);
    console.log(`[recipe] OCR: python=${PYTHON}, script=${OCR_SCRIPT}, file=${tmpFile}`);

    const { stdout, stderr } = await execFileAsync(
      PYTHON,
      [OCR_SCRIPT, tmpFile],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );

    console.log(`[recipe] OCR stdout len=${stdout?.length}, stderr=${stderr?.slice(0, 200)}`);

    if (!stdout.trim()) {
      throw new Error(`OCR script returned empty output. stderr: ${stderr?.slice(0, 300)}`);
    }

    const parsed = JSON.parse(stdout);
    console.log(`[recipe] OCR parsed: code=${parsed.code}, rows=${parsed.rows?.length}, name=${parsed.name}`);

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
