import axios from "axios";
import { JWT } from "google-auth-library";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1XLQ1FSJOXLwIgEhbAtz95yrVXbEzBYQkAgQ5XEnLxOA";
const GOOGLE_SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const SHEETS_BASE = "https://sheets.googleapis.com";

let _jwtClient: JWT | null = null;

async function getAuthHeader(): Promise<string> {
  if (!GOOGLE_SA_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  if (!_jwtClient) {
    const creds = JSON.parse(GOOGLE_SA_JSON);
    _jwtClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  const { token } = await _jwtClient.getAccessToken();
  return `Bearer ${token}`;
}

/** Parse numbers that may use comma as decimal separator (European locale from Google Sheets) */
function parseNum(v: any): number {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

// ─── In-memory TTL cache ────────────────────────────────────────────────────
const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data as T;
  cache.delete(key);
  return undefined;
}
function cacheSet(key: string, data: any): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}
export function invalidateCache(): void {
  cache.clear();
}

// ─── Rate limiter for the Sheets API ────────────────────────────────────────
// Google ограничивает ~10 запросов/сек на repl. Дашборд читает несколько листов
// через Promise.all, плюс параллельно опрашиваются вкладки склада и клиент —
// бурст легко превышает лимит и часть ответов падает 429 → 500. Пропускаем все
// вызовы через токен-бакет (≤ MAX_RPS в скользящую секунду) и ретраим
// rate-limit с бэкоффом. Бизнес-логика не меняется.
const MAX_RPS = 8;
const MAX_RETRIES = 5;
let _windowStart = 0;
let _countInWindow = 0;
let _slotChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.max(0, ms)));
}

// Резервирует «слот» под один запрос, не превышая MAX_RPS в секунду.
// Захват счётчика сериализован через _slotChain, сам HTTP идёт параллельно.
async function acquireSlot(): Promise<void> {
  const prev = _slotChain;
  let release!: () => void;
  _slotChain = new Promise<void>(r => { release = r; });
  await prev;
  try {
    let now = Date.now();
    if (now - _windowStart >= 1000) {
      _windowStart = now;
      _countInWindow = 0;
    }
    if (_countInWindow >= MAX_RPS) {
      await sleep(1000 - (now - _windowStart));
      _windowStart = Date.now();
      _countInWindow = 0;
    }
    _countInWindow++;
  } finally {
    release();
  }
}

function isRateLimited(x: any): boolean {
  if (!x) return false;
  const status = x?.response?.status ?? x?.code ?? x?.status;
  if (status === 429 || status === "429") return true;
  const msg = String(x?.response?.data?.error?.message ?? x?.message ?? x?.status ?? "");
  return /rate limit|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

async function rawSheetGet(path: string) {
  if (GOOGLE_SA_JSON) {
    const auth = await getAuthHeader();
    const { data } = await axios.get(`${SHEETS_BASE}${path}`, { headers: { Authorization: auth } });
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ReplitConnectors } = require("@replit/connectors-sdk");
  const r = await new ReplitConnectors().proxy("google-sheet", path, { method: "GET" });
  return r.json();
}

async function sheetGet(path: string) {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    try {
      const data = await rawSheetGet(path);
      // Прокси-путь не бросает на 429 — отдаёт тело {error:{...}}. Ловим здесь и
      // ретраим, чтобы readRange не превратил временный лимит в постоянную ошибку.
      if (data && data.error && isRateLimited(data.error) && attempt < MAX_RETRIES) {
        await sleep(250 * (attempt + 1) ** 2);
        continue;
      }
      return data;
    } catch (err) {
      if (isRateLimited(err) && attempt < MAX_RETRIES) {
        await sleep(250 * (attempt + 1) ** 2);
        continue;
      }
      throw err;
    }
  }
}

async function sheetPost(path: string, body: object) {
  await acquireSlot();
  if (GOOGLE_SA_JSON) {
    const auth = await getAuthHeader();
    const { data } = await axios.post(`${SHEETS_BASE}${path}`, body, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
    });
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ReplitConnectors } = require("@replit/connectors-sdk");
  const r = await new ReplitConnectors().proxy("google-sheet", path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

async function sheetPut(path: string, body: object) {
  await acquireSlot();
  if (GOOGLE_SA_JSON) {
    const auth = await getAuthHeader();
    const { data } = await axios.put(`${SHEETS_BASE}${path}`, body, {
      headers: { Authorization: auth, "Content-Type": "application/json" },
    });
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ReplitConnectors } = require("@replit/connectors-sdk");
  const r = await new ReplitConnectors().proxy("google-sheet", path, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

export async function readRange(sheet: string, range: string): Promise<any[][]> {
  const fullRange = `${sheet}!${range}`;
  const cacheKey = `range:${fullRange}`;
  const cached = cacheGet<any[][]>(cacheKey);
  if (cached) return cached;
  const d = await sheetGet(`/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(fullRange)}`);
  // Не глушить ошибки чтения. Прокси-путь (ReplitConnectors) возвращает тело
  // ответа как есть: при 429/401/5xx это {error:{...}} БЕЗ поля values. Если
  // молча отдать [], вызывающий код (matchBatch и др.) примет это за «пустой
  // лист» и выдаст уверенно-неверный результат («0 строк распознано»), а пустой
  // ответ ещё и закэшируется на CACHE_TTL — один сбой отравляет все чтения
  // диапазона на 30 c. Поэтому при ошибке бросаем и НЕ кэшируем.
  if (d && d.error) {
    const e = d.error;
    throw new Error(
      `Sheets readRange ${fullRange} failed: ${e.code ?? ""} ${e.status ?? ""} ${e.message ?? JSON.stringify(e)}`.trim()
    );
  }
  const result = d.values || [];
  cacheSet(cacheKey, result);
  return result;
}

export async function clearRange(sheet: string, range: string): Promise<void> {
  invalidateCache();
  await sheetPost(`/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${range}`)}:clear`, {});
}

export async function writeRange(sheet: string, range: string, values: any[][]): Promise<void> {
  invalidateCache();
  await sheetPut(
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${range}`)}?valueInputOption=USER_ENTERED`,
    { values }
  );
}

export async function appendRows(sheet: string, values: any[][]): Promise<void> {
  invalidateCache();
  await sheetPost(
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values }
  );
}

// ─── SHEET CREATION ─────────────────────────────────────────────────────────

async function ensureSheets(titles: string[]): Promise<void> {
  try {
    const meta = await sheetGet(`/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`);
    const existing = new Set<string>((meta.sheets || []).map((s: any) => String(s.properties?.title || "")));
    const toCreate = titles.filter(t => !existing.has(t));
    if (!toCreate.length) return;
    const requests = toCreate.map(title => ({ addSheet: { properties: { title } } }));
    await sheetPost(`/v4/spreadsheets/${SHEET_ID}:batchUpdate`, { requests });
  } catch { /* sheet may already exist or API not available */ }
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
      avg_monthly_usage: parseNum(r[4]),
      reorder_threshold_factor: parseNum(r[5]) || 0.5,
      lead_time_days: parseInt(String(r[6])) || 30,
      active: String(r[7]).toUpperCase() !== "FALSE",
    }));
}

/**
 * Удаление позиции каталога (Syryo) по uid. Очищает ячейки строки A:H —
 * getAllRawMaterials отфильтрует пустую строку (фильтр r[0] && r[1]).
 * Возвращает true, если позиция найдена и удалена.
 */
export async function deleteRawMaterial(uid: string): Promise<boolean> {
  const rows = await readRange("Syryo", "A2:H1000");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === uid) {
      await clearRange("Syryo", `A${i + 2}:H${i + 2}`);
      return true;
    }
  }
  return false;
}

/**
 * Сливает позицию `sourceUid` в `targetUid` (и опционально переименовывает target).
 *
 * Перепривязывает код позиции source→target во ВСЕХ листах данных (PlantStock,
 * LipStock, LipBatches, Inbound, Need) и в синонимах (оба формата листа Aliases),
 * сохраняя историю — меняется только код в строке, сами данные/даты не трогаем.
 * Прежнее название source добавляется синонимом к target, чтобы оно и дальше
 * распознавалось при загрузках. Source удаляется из каталога Syryo.
 *
 * Возвращает счётчики затронутых строк по каждому листу.
 */
export async function mergeRawMaterials(
  sourceUid: string,
  targetUid: string,
  rename?: { full_name?: string; short_name?: string },
): Promise<{ plant: number; lip: number; lipBatches: number; inbound: number; need: number; aliases: number }> {
  if (!sourceUid || !targetUid || sourceUid === targetUid) {
    throw new Error("Нужны два разных кода: source и target");
  }

  const syryo = await readRange("Syryo", "A2:H1000");
  let sourceRowIdx = -1, targetRowIdx = -1;
  for (let i = 0; i < syryo.length; i++) {
    if (syryo[i][0] === sourceUid) sourceRowIdx = i;
    if (syryo[i][0] === targetUid) targetRowIdx = i;
  }
  if (sourceRowIdx < 0) throw new Error(`Позиция ${sourceUid} не найдена в каталоге`);
  if (targetRowIdx < 0) throw new Error(`Позиция ${targetUid} не найдена в каталоге`);

  const sourceRow = syryo[sourceRowIdx];
  const targetRow = syryo[targetRowIdx];
  const sourceName = String(sourceRow[1] || "");

  // 1) Заготавливаем новую строку target (переименование + суммирование расхода
  // обеих позиций). САМУ ЗАПИСЬ делаем последним шагом — после удаления source,
  // чтобы повторный запуск после частичного сбоя не удваивал avg (target меняется
  // только когда source уже гарантированно удалён, см. шаг 6).
  const mergedUsage = parseNum(targetRow[4]) + parseNum(sourceRow[4]);
  const newTargetRow = [
    targetUid,
    rename?.full_name ?? targetRow[1],
    rename?.short_name ?? targetRow[2],
    targetRow[3] || "кг",
    mergedUsage,
    targetRow[5] ?? 0.5,
    targetRow[6] ?? 30,
    targetRow[7] ?? "TRUE",
  ];

  // 2) Перепривязка кода во всех листах остатков/потребности (точечно по ячейке).
  // Ошибки чтения НЕ глушим: эти листы всегда существуют (ensureSheets), поэтому
  // сбой чтения — это реальный transient-сбой, и слияние должно прерваться громко,
  // а не вернуть «0 перенесено» с молчаливо неперепривязанным остатком source.
  const rekey = async (sheet: string, range: string, colIdx: number, colLetter: string): Promise<number> => {
    const rows = await readRange(sheet, range);
    let changed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][colIdx] || "") === sourceUid) {
        await writeRange(sheet, `${colLetter}${i + 2}:${colLetter}${i + 2}`, [[targetUid]]);
        changed++;
      }
    }
    return changed;
  };

  const plant = await rekey("PlantStock", "A2:G5000", 1, "B");
  const lip = await rekey("LipStock", "A2:I5000", 1, "B");
  const lipBatches = await rekey("LipBatches", "A2:G5000", 1, "B");
  const inbound = await rekey("Inbound", "A2:H5000", 1, "B");
  const need = await rekey("Need", "A2:H5000", 2, "C");

  // 3) Перепривязка синонимов source→target (оба формата строки Aliases).
  // Лист Aliases в этом приложении никогда не бывает пустым — пустой ответ
  // означает временный сбой чтения Google. Прерываемся «громко», чтобы не
  // получить молчаливое частичное слияние (синонимы/удаление не применятся).
  const aliasRows = await readRange("Aliases", "A2:D5000");
  if (!aliasRows.length) {
    throw new Error("Лист Aliases вернулся пустым (временный сбой чтения) — слияние прервано, повторите");
  }
  let aliases = 0;
  for (let i = 0; i < aliasRows.length; i++) {
    const a = String(aliasRows[i][0] || "");
    const b = String(aliasRows[i][1] || "");
    if (a === sourceUid) {
      await writeRange("Aliases", `A${i + 2}:A${i + 2}`, [[targetUid]]);
      aliases++;
    } else if (a.startsWith("AL_") && b === sourceUid) {
      await writeRange("Aliases", `B${i + 2}:B${i + 2}`, [[targetUid]]);
      aliases++;
    }
  }

  // 4) Прежнее название source — синонимом к target (addAlias дедуплицирует сам).
  if (sourceName) await addAlias(targetUid, sourceName, "merge");

  // 5) Удаляем source из каталога. Если строка вдруг не нашлась (временный сбой
  // чтения Syryo) — прерываемся «громко», чтобы source не остался в каталоге молча.
  const deleted = await deleteRawMaterial(sourceUid);
  if (!deleted) {
    throw new Error(`Не удалось удалить ${sourceUid} из каталога (временный сбой) — повторите слияние`);
  }

  // 6) Запись переименования/суммы расхода target — ПОСЛЕДНИМ шагом (см. шаг 1).
  await writeRange("Syryo", `A${targetRowIdx + 2}:H${targetRowIdx + 2}`, [newTargetRow]);

  invalidateCache();
  return { plant, lip, lipBatches, inbound, need, aliases };
}

export interface ParsedAlias {
  /** col A исходной строки (AL_xxx или код) — используется DELETE-роутом. */
  id: string;
  /** Исходный код привязки (col A для старого формата, col B для AL_). */
  code: string;
  /**
   * Канонический код каталога. Заполняется ТОЛЬКО когда `code` точно совпадает
   * с кодом позиции каталога; иначе `null`. Никогда не содержит неканонический
   * (неразрешённый) код — потреблять для привязки можно без доп. проверок.
   */
  canonical_raw_uid: string | null;
  /** `true` ⇔ `canonical_raw_uid !== null` (удобный флаг для фильтрации). */
  resolved: boolean;
  /** Текст синонима / торгового названия. */
  synonym: string;
  source: string;
}

/**
 * Единый разбор листа Aliases. Терпит два формата строк:
 *   NEW (авто):    A=AL_xxx, B=raw_uid, C=текст_синонима, D=источник
 *   OLD (ручной):  A=код,    B=текст_синонима, C=тип, D=источник
 *
 * ВАЖНО: код считается валидным только при ТОЧНОМ совпадении с кодом каталога.
 * Курируемые строки используют коды вида «RAW030» из старой схемы нумерации,
 * которая НЕ соответствует текущему каталогу («RAW_030» — это другая позиция).
 * Поэтому «нормализация подчёркивания» запрещена: она даёт уверенно-неверные
 * привязки (например, «Сульфат марганца» → «Биогром Холин»). Такие строки
 * помечаем resolved=false и НЕ используем для сопоставления.
 */
export function parseAliasRows(
  aliasRows: any[][],
  materials: { raw_uid: string }[],
): ParsedAlias[] {
  const validUids = new Set(materials.map(m => m.raw_uid));

  const out: ParsedAlias[] = [];
  for (const row of aliasRows) {
    if (!row[0]) continue;
    const col0 = String(row[0]);
    let codeRaw: string | null;
    let aliasText: string | null;
    if (col0.startsWith("AL_")) {
      codeRaw = row[1] ? String(row[1]) : null;
      aliasText = row[2] ? String(row[2]) : null;
    } else {
      codeRaw = col0;
      aliasText = row[1] ? String(row[1]) : null;
    }
    if (!codeRaw || !aliasText) continue;
    const resolved = validUids.has(codeRaw);
    out.push({
      id: col0,
      code: codeRaw,
      canonical_raw_uid: resolved ? codeRaw : null,
      resolved,
      synonym: aliasText,
      source: row[3] ? String(row[3]) : "",
    });
  }
  return out;
}

// ─── Защита от неверных автопривязок (fuzzy-сопоставление) ───────────────────
// Служебные / не-сырьевые токены: тара, фасовка, единицы измерения и т.п.
// Они не несут смысла вещества, поэтому исключаются из сопоставления —
// иначе общие слова («мешок», «кг», «упаковка») дают уверенно-неверные
// привязки на пустом перекрытии. Для снабжения неверная привязка опаснее
// отсутствия (можно заказать не то вещество).
export const DENY_TOKENS = new Set<string>([
  "мешок", "мешки", "мешка", "мешков", "мешочек",
  "тара", "упаковка", "упак", "уп", "фасовка", "фасованный",
  "пакет", "пакеты", "коробка", "короб", "ящик", "ящ",
  "ведро", "канистра", "бочка", "фляга", "флакон", "банка",
  "биг", "бэг", "бег", "бигбэг", "бигбег", "паллета", "паллет", "поддон",
  "мкр", "полипропиленовый", "пп",
  "кг", "г", "гр", "грамм", "мг", "л", "мл", "т", "тн", "тонна", "тоннах",
  "шт", "штук", "штука", "штуки", "ед", "нетто", "брутто", "около",
]);

// Токен — это число с возможной единицей/процентом («25», «25кг», «32%», «0,5л»).
const NUM_UNIT_RE = /^\d+([.,]\d+)?(кг|г|гр|мг|л|мл|т|тн|шт|%)?$/;

/**
 * Разбивает строку на «значащие» токены вещества: без тары/фасовки/единиц,
 * без чисел и слишком коротких служебных слов. Эти токены — основа порога
 * словного перекрытия для fuzzy-ветки.
 */
export function significantTokens(s: string): string[] {
  return String(s)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9%]+/gi, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !DENY_TOKENS.has(t) && !NUM_UNIT_RE.test(t));
}

/**
 * Оценивает уверенность fuzzy-совпадения по перекрытию значащих токенов.
 * Возвращает >0 (балл) только если совпадение уверенное, иначе 0.
 *
 * Уверенным считаем случай, когда один набор значащих токенов целиком
 * содержится в другом (кандидат «обёрнут» тарой/фасовкой во входной строке
 * либо наоборот). Это отсекает совпадения по общему префиксу/служебному слову:
 * «Сульфат марганца» и «Сульфат магния» делят лишь «сульфат» и НЕ являются
 * подмножеством друг друга → привязки не будет.
 */
export function tokenMatchScore(aTokens: string[], bTokens: string[]): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const shared = [...bSet].filter(t => aSet.has(t));
  if (!shared.length) return 0;
  const bSubsetOfA = [...bSet].every(t => aSet.has(t));
  const aSubsetOfB = [...aSet].every(t => bSet.has(t));
  if (!bSubsetOfA && !aSubsetOfB) return 0;
  // Единственный общий токен должен быть достаточно характерным,
  // иначе короткое общее слово свяжет разные вещества.
  if (shared.length === 1 && shared[0].length < 5) return 0;
  return shared.reduce((sum, t) => sum + t.length, 0) + shared.length;
}

/** Нормализация текста позиции для сравнения (нижний регистр, схлопнутые пробелы). */
function normExcl(s: string): string {
  return String(s).toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Фильтр «похоже на сырьё/добавку» — ТОЛЬКО для КД Липковской. В КД много
 * мусора (хозтовары, запчасти, тара), который сырьём не является. Оставляем в
 * распознавании лишь те позиции, что похожи на что-то из эталонного корпуса:
 * справочник + синонимы + амбарка Полоцка (PlantStock) + компоненты рецепта.
 *
 * Похожесть — наличие общего «значащего» токена (тара/единицы/числа отброшены):
 * либо характерного (>=4 симв.), либо хотя бы двух общих токенов. Возвращает
 * множество имён, прошедших фильтр.
 */
export async function filterKdSimilar(names: string[]): Promise<Set<string>> {
  const keep = new Set<string>();
  if (!names.length) return keep;
  const [materials, aliasRows, plantRows, recipeRows] = await Promise.all([
    getAllRawMaterials(),
    readRange("Aliases", "A2:D5000"),
    readRange("PlantStock", "A2:G5000"),
    readRange("RecipeLines", "A2:L5000"),
  ]);
  const refTexts: string[] = [];
  for (const m of materials) { refTexts.push(m.full_name); refTexts.push(m.short_name); }
  for (const a of parseAliasRows(aliasRows, materials)) refTexts.push(a.synonym);
  for (const r of plantRows) if (r[2]) refTexts.push(String(r[2]));
  for (const r of recipeRows) if (r[3]) refTexts.push(String(r[3]));

  const refTokens = new Set<string>();
  for (const t of refTexts) for (const tok of significantTokens(t)) refTokens.add(tok);

  for (const name of names) {
    const toks = significantTokens(name);
    if (!toks.length) continue;
    const shared = toks.filter(t => refTokens.has(t));
    if (shared.some(t => t.length >= 4) || shared.length >= 2) keep.add(name);
  }
  return keep;
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

  // Aliases sheet lookup (формат-независимо, с резолвом кода)
  const aliasRows = await readRange("Aliases", "A2:D5000");
  for (const a of parseAliasRows(aliasRows, materials)) {
    if (a.canonical_raw_uid && a.synonym.toLowerCase().trim() === normalized) {
      return a.canonical_raw_uid;
    }
  }

  // Fuzzy — по уверенному перекрытию значащих токенов (с deny-list и порогом).
  // Неуверенные кандидаты НЕ привязываются (возврат null → ручная проверка).
  const nTokens = significantTokens(normalized);
  if (!nTokens.length) return null;
  let best: { uid: string; score: number } | null = null;
  for (const m of materials) {
    const sf = tokenMatchScore(nTokens, significantTokens(m.full_name));
    if (sf > 0 && (!best || sf > best.score)) best = { uid: m.raw_uid, score: sf };
    const ss = tokenMatchScore(nTokens, significantTokens(m.short_name));
    if (ss > 0 && (!best || ss > best.score)) best = { uid: m.raw_uid, score: ss };
  }
  return best ? best.uid : null;
}

/**
 * Batch matcher: loads materials + aliases ONCE, then resolves all names in-memory.
 * Returns a Map<originalName, raw_uid | null>.
 * Use this in upload handlers instead of calling findRawByAlias() in a loop.
 */
export async function matchBatch(names: string[]): Promise<Map<string, string | null>> {
  const [materials, aliasRows] = await Promise.all([
    getAllRawMaterials(),
    readRange("Aliases", "A2:D5000"),
  ]);

  // Каталог (Syryo) — инвариант: он всегда непустой. Пустой здесь означает
  // сбой чтения Sheets, а не «нет сырья». Без этой проверки сопоставление вернёт
  // все null и рецепт молча сохранится с «0 строк распознано». Бросаем, чтобы
  // загрузка упала явно (клиент покажет ошибку, можно повторить), а не записала
  // заведомо неверный результат.
  if (!materials.length) {
    throw new Error("matchBatch: каталог сырья (Syryo) пуст — вероятен сбой чтения Google Sheets");
  }

  // Build lookup structures
  const byFullName  = new Map(materials.map(m => [m.full_name.toLowerCase().trim(), m.raw_uid]));
  const byShortName = new Map(materials.map(m => [m.short_name.toLowerCase().trim(), m.raw_uid]));

  // Синонимы → канонический код каталога (формат-независимо, RAW001 ⇔ RAW_001).
  // Нерезолвящиеся коды (например, RAW070 — нет в каталоге) пропускаем.
  const byAlias = new Map<string, string>();
  for (const a of parseAliasRows(aliasRows, materials)) {
    if (a.canonical_raw_uid) byAlias.set(a.synonym.toLowerCase().trim(), a.canonical_raw_uid);
  }

  // Pre-build значащие токены кандидатов для fuzzy-ветки (deny-list + порог).
  const aliasTokenList = Array.from(byAlias.entries())
    .map(([alias, uid]) => ({ uid, tokens: significantTokens(alias) }))
    .filter(e => e.tokens.length > 0);
  const materialTokenList = materials.map(m => ({
    uid: m.raw_uid,
    fullTokens: significantTokens(m.full_name),
    shortTokens: significantTokens(m.short_name),
  }));

  const result = new Map<string, string | null>();
  for (const name of names) {
    const n = name.toLowerCase().trim();
    if (byFullName.has(n))  { result.set(name, byFullName.get(n)!);  continue; }
    if (byShortName.has(n)) { result.set(name, byShortName.get(n)!); continue; }
    if (byAlias.has(n))     { result.set(name, byAlias.get(n)!);     continue; }

    // Fuzzy: только уверенное перекрытие значащих токенов. Тара/фасовка/единицы
    // («мешок 25 кг», «32%») отброшены, совпадения по общему слову не проходят.
    // Неуверенные кандидаты → null → строка уходит в очередь на ручную проверку.
    const nTokens = significantTokens(name);
    if (!nTokens.length) { result.set(name, null); continue; }

    let best: { uid: string; score: number } | null = null;
    // Fuzzy 1: перекрытие с известным синонимом (курируемые имена точнее).
    for (const e of aliasTokenList) {
      const s = tokenMatchScore(nTokens, e.tokens);
      if (s > 0 && (!best || s > best.score)) best = { uid: e.uid, score: s };
    }
    // Fuzzy 2: перекрытие с позицией каталога (full / short name).
    for (const m of materialTokenList) {
      const sf = tokenMatchScore(nTokens, m.fullTokens);
      if (sf > 0 && (!best || sf > best.score)) best = { uid: m.uid, score: sf };
      const ss = tokenMatchScore(nTokens, m.shortTokens);
      if (ss > 0 && (!best || ss > best.score)) best = { uid: m.uid, score: ss };
    }
    result.set(name, best ? best.uid : null);
  }
  return result;
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

/**
 * Add multiple aliases in a single append call.
 * Skips entries already present in existingAliasRows.
 */
export async function addAliasesBatch(
  entries: { raw_uid: string; alias: string; source: string }[],
  existingAliasRows?: any[][]
): Promise<void> {
  const existing = existingAliasRows ?? await readRange("Aliases", "A2:D5000");
  const existingSet = new Set(existing.map(r => `${r[1]}|${String(r[2]).toLowerCase()}`));
  const newRows = entries
    .filter(e => !existingSet.has(`${e.raw_uid}|${e.alias.toLowerCase()}`))
    .map(e => [`AL_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, e.raw_uid, e.alias, e.source]);
  if (newRows.length) await appendRows("Aliases", newRows);
}

export async function addToReviewQueue(text: string, source_type: string, file_name: string): Promise<void> {
  const id = `RQ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await appendRows("ReviewQueue", [[id, text, source_type, file_name, "FALSE", new Date().toISOString()]]);
}

/**
 * Add multiple review queue items in a single append call.
 */
export async function addToReviewQueueBatch(
  items: { text: string; source_type: string; file_name: string }[]
): Promise<void> {
  if (!items.length) return;
  // Не добавляем то, что уже исключено пользователем («не сырьё»), и не плодим
  // дубли с уже висящими в очереди нерешёнными позициями.
  const [excluded, existing] = await Promise.all([
    getExcludedSet(),
    readRange("ReviewQueue", "A2:F2000"),
  ]);
  const queued = new Set<string>();
  for (const r of existing) {
    if (r[0] && String(r[4]).toUpperCase() !== "TRUE") queued.add(normExcl(String(r[1] || "")));
  }
  const seen = new Set<string>();
  const rows: any[][] = [];
  items.forEach((it, i) => {
    const key = normExcl(it.text);
    if (!key || excluded.has(key) || queued.has(key) || seen.has(key)) return;
    seen.add(key);
    rows.push([
      `RQ_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      it.text, it.source_type, it.file_name, "FALSE", new Date().toISOString(),
    ]);
  });
  if (rows.length) await appendRows("ReviewQueue", rows);
}

export async function getUnresolvedQueue(): Promise<any[]> {
  const [rows, excluded] = await Promise.all([
    readRange("ReviewQueue", "A2:F2000"),
    getExcludedSet(),
  ]);
  return rows
    .filter(r => r[0] && String(r[4]).toUpperCase() !== "TRUE")
    // Скрываем чисто числовые строки (425, 6799, 1,500.000 и т.п.) — это суммы/
    // количества, ошибочно попавшие в очередь до фикса парсера, а не сырьё.
    .filter(r => !/^[\d\s.,]+$/.test(String(r[1] || "").trim()))
    // Скрываем то, что пользователь ранее исключил как «не сырьё».
    .filter(r => !excluded.has(normExcl(String(r[1] || ""))))
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

/** Помечает обработанными ВСЕ нерешённые строки очереди с данным текстом. */
export async function resolveQueueByText(text: string): Promise<void> {
  const key = normExcl(text);
  const rows = await readRange("ReviewQueue", "A2:F2000");
  if (!rows.length) return;
  let changed = false;
  const eCol = rows.map(r => {
    const cur = String(r[4] || "");
    if (r[0] && normExcl(String(r[1] || "")) === key && cur.toUpperCase() !== "TRUE") {
      changed = true;
      return ["TRUE"];
    }
    return [cur];
  });
  if (changed) await writeRange("ReviewQueue", `E2:E${eCol.length + 1}`, eCol);
}

// ─── EXCLUDED (исключённые из распознавания «не сырьё») ───────────────────────
// Лист Excluded: A=нормализованный текст, B=исходный текст, C=источник, D=дата.
// Исключения глобальные и постоянные — позиция не попадёт в распознавание ни при
// одной будущей загрузке.

export async function getExcludedSet(): Promise<Set<string>> {
  await ensureSheets(["Excluded"]);
  const rows = await readRange("Excluded", "A2:D5000");
  const set = new Set<string>();
  for (const r of rows) if (r[0]) set.add(normExcl(String(r[0])));
  return set;
}

export async function getExcludedList(): Promise<
  { text: string; source_type: string; created_at: string }[]
> {
  await ensureSheets(["Excluded"]);
  const rows = await readRange("Excluded", "A2:D5000");
  return rows
    .filter(r => r[0])
    .map(r => ({
      text: String(r[1] || r[0]),
      source_type: String(r[2] || ""),
      created_at: String(r[3] || ""),
    }))
    .reverse();
}

export async function addExcludedBatch(
  items: { text: string; source_type: string }[]
): Promise<void> {
  if (!items.length) return;
  await ensureSheets(["Excluded"]);
  const existing = await readRange("Excluded", "A2:D5000");
  const have = new Set(existing.map(r => normExcl(String(r[0] || ""))));
  const seen = new Set<string>();
  const rows: any[][] = [];
  for (const it of items) {
    const key = normExcl(it.text);
    if (!key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    rows.push([key, it.text, it.source_type, new Date().toISOString()]);
  }
  if (rows.length) await appendRows("Excluded", rows);
}

// ─── PLANT STOCK ────────────────────────────────────────────────────────────

export async function writePlantStock(rows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[]): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  // Clear today's entries first to avoid duplicates
  const existing = await readRange("PlantStock", "A2:G5000");
  const keepRows = existing.filter(r => toIsoSnapshotDate(r[0]) !== today);
  await clearRange("PlantStock", "A2:G5000");
  if (keepRows.length) await writeRange("PlantStock", `A2:G${keepRows.length + 1}`, keepRows);

  const newRows = rows.map(r => [today, r.raw_uid, r.name_from_source, r.qty, "кг", r.source_file, "FALSE"]);
  if (newRows.length) await appendRows("PlantStock", newRows);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Нормализует значение колонки даты-снимка к ISO «YYYY-MM-DD».
 *
 * При valueInputOption=USER_ENTERED Google Sheets распознаёт записанную
 * ISO-строку как дату и в зависимости от формата ячейки при чтении может
 * вернуть её как ПОРЯДКОВЫЙ НОМЕР Excel (например «46185» = 2026-06-11).
 * Из-за этого строгая проверка ISO_DATE отбрасывала весь снимок, и остатки
 * (Полоцк) не отображались. Принимаем оба варианта: готовую ISO-строку и
 * серийный номер Excel в разумном диапазоне дат.
 */
function toIsoSnapshotDate(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (ISO_DATE.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(parseFloat(s));
    if (serial >= 30000 && serial <= 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
  }
  return "";
}

/**
 * Суммирует остатки ТОЛЬКО по последнему снимку склада.
 *
 * Каждая загрузка файла = полный снимок остатков склада на эту дату (старые
 * даты остаются в листе как история). Поэтому берём максимальную дату-снимок
 * и суммируем количество ПО ВСЕМ строкам каждого raw_uid в этом снимке
 * (одна позиция может идти несколькими строками — разные партии/проценты).
 * Позиция, которой нет в последнем снимке, считается отсутствующей (0), а не
 * берётся из устаревшего снимка — иначе «всплывали» давно списанные остатки.
 */
function sumLatestSnapshot(rows: any[][], qtyOf: (r: any[]) => number): Map<string, number> {
  let maxDate = "";
  for (const r of rows) {
    const d = toIsoSnapshotDate(r[0]);
    if (d && d > maxDate) maxDate = d;
  }
  const map = new Map<string, number>();
  if (!maxDate) return map;
  for (const r of rows) {
    if (toIsoSnapshotDate(r[0]) !== maxDate) continue;
    if (!r[1]) continue;
    const uid = String(r[1]);
    map.set(uid, round2((map.get(uid) || 0) + qtyOf(r)));
  }
  return map;
}

export async function getLatestPlantStock(): Promise<Map<string, number>> {
  const rows = await readRange("PlantStock", "A2:G5000");
  return sumLatestSnapshot(rows, r => parseNum(r[3]));
}

// ─── LIP STOCK ──────────────────────────────────────────────────────────────

export async function writeLipStock(
  raw_uid: string, name_from_source: string,
  qty_on_hand: number, reserved_qty: number, free_qty: number, source: string
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const existing = await readRange("LipStock", "A2:I5000");
  const free = free_qty >= 0 ? free_qty : Math.max(0, qty_on_hand - reserved_qty);
  const updatedRow = [today, raw_uid, name_from_source, qty_on_hand, reserved_qty, free, "кг", source, "FALSE"];

  // Ручное обновление ОДНОЙ позиции. Чтение остатков берёт только последний
  // снимок (макс. дату), поэтому переносим текущий снимок в сегодня целиком —
  // иначе все прочие позиции «обнулятся». Переносим лишь то, что есть в
  // последнем снимке (списанные/отсутствующие позиции не воскрешаем).
  let maxDate = "";
  for (const r of existing) {
    const d = toIsoSnapshotDate(r[0]);
    if (d && d > maxDate) maxDate = d;
  }
  const snapshot: any[][] = [];
  for (const r of existing) {
    if (toIsoSnapshotDate(r[0]) !== maxDate) continue;
    const uid = String(r[1] || "");
    if (!uid || uid === raw_uid) continue;
    snapshot.push([today, uid, r[2], r[3], r[4], r[5], r[6] || "кг", r[7] || "", "FALSE"]);
  }
  snapshot.push(updatedRow);

  // Историю (старые даты) сохраняем, сверху кладём полный снимок на сегодня.
  const history = existing.filter(r => {
    const d = toIsoSnapshotDate(r[0]);
    return !!d && d !== today;
  });
  const allRows = [...history, ...snapshot];
  // Безопасная замена: СНАЧАЛА пишем данные, ПОТОМ подчищаем хвост старых строк.
  // Если делать наоборот (clear→write) и второй шаг сорвётся (лимит/сбой), лист
  // остаётся пустым и остатки Липковской пропадают полностью.
  if (allRows.length) {
    await writeRange("LipStock", `A2:I${allRows.length + 1}`, allRows);
    if (existing.length > allRows.length) {
      await clearRange("LipStock", `A${allRows.length + 2}:I${existing.length + 1}`);
    }
  } else {
    await clearRange("LipStock", "A2:I5000");
  }
  invalidateCache();
}

/**
 * Write all Lipkovskaya stock rows in one operation (3 API calls total).
 * Replaces all today's entries in one clear+write instead of N×4 calls.
 */
export async function writeLipStockBatch(
  rows: { raw_uid: string; name_from_source: string; qty: number; source: string }[]
): Promise<void> {
  if (!rows.length) return;
  const today = new Date().toISOString().split("T")[0];
  // Загрузка файла = полный снимок склада: заменяем ВСЕ сегодняшние строки
  // (а не только пришедшие uid), иначе повторная загрузка с меньшим набором
  // позиций оставит «висеть» устаревшие строки. Старые даты — история.
  const existing = await readRange("LipStock", "A2:I5000");
  const keepRows = existing.filter(r => toIsoSnapshotDate(r[0]) !== today);
  const newRows = rows.map(r => [today, r.raw_uid, r.name_from_source, r.qty, 0, r.qty, "кг", r.source, "FALSE"]);
  const allRows = [...keepRows, ...newRows];
  // Безопасная замена: сначала запись, затем подчистка хвоста (см. writeLipStock),
  // чтобы сбой между шагами не оставил лист LipStock пустым.
  if (allRows.length) {
    await writeRange("LipStock", `A2:I${allRows.length + 1}`, allRows);
    if (existing.length > allRows.length) {
      await clearRange("LipStock", `A${allRows.length + 2}:I${existing.length + 1}`);
    }
  } else {
    await clearRange("LipStock", "A2:I5000");
  }
  invalidateCache();
}

// ─── LIP BATCHES (КД — ведомость по партиям) ────────────────────────────────

/**
 * Writes КД batch rows to LipBatches sheet — one row per batch.
 * Replaces all today's rows for the given raw_uid set in one operation.
 */
export async function writeLipBatchesBulk(
  rows: { raw_uid: string; batch_code: string; vendor_name: string; qty: number; source: string }[]
): Promise<void> {
  if (!rows.length) return;
  await ensureSheets(["LipBatches"]);
  const today = new Date().toISOString().split("T")[0];
  let existing: any[][] = [];
  try { existing = await readRange("LipBatches", "A2:G5000"); } catch {}
  const keepRows = existing.filter(r => toIsoSnapshotDate(r[0]) !== today);
  const newRows = rows.map(r => [today, r.raw_uid, r.batch_code, r.vendor_name, r.qty, "кг", r.source]);
  const allRows = [...keepRows, ...newRows];
  // Безопасная замена: сначала запись, затем подчистка хвоста (см. writeLipStock),
  // чтобы сбой между шагами не уничтожил партии Липковской.
  if (allRows.length) {
    await writeRange("LipBatches", `A2:G${allRows.length + 1}`, allRows);
    if (existing.length > allRows.length) {
      await clearRange("LipBatches", `A${allRows.length + 2}:G${existing.length + 1}`);
    }
  } else {
    await clearRange("LipBatches", "A2:G5000");
  }
  invalidateCache();
}

export async function getLipBatchesList(): Promise<any[]> {
  try {
    await ensureSheets(["LipBatches"]);
    const rows = await readRange("LipBatches", "A2:G5000");
    return rows.filter(r => r[0]).map(r => ({
      snapshot_date: r[0], raw_uid: r[1], batch_code: r[2],
      vendor_name: r[3], qty: parseNum(r[4]), unit: r[5], source: r[6],
    }));
  } catch { return []; }
}

/** Returns sum of latest КД snapshot per raw_uid (for use in computeDecisions). */
export async function getLatestLipBatchStock(): Promise<Map<string, number>> {
  try {
    const rows = await readRange("LipBatches", "A2:G5000");
    // Accumulate totals per (uid, date); keep only latest date per uid
    const byUid = new Map<string, { date: string; total: number }>();
    for (const r of rows) {
      if (!r[1]) continue;
      const uid = String(r[1]);
      const date = toIsoSnapshotDate(r[0]);
      if (!date) continue;
      const qty = parseNum(r[4]);
      const cur = byUid.get(uid);
      if (!cur) {
        byUid.set(uid, { date, total: qty });
      } else if (date > cur.date) {
        byUid.set(uid, { date, total: qty }); // newer snapshot → reset
      } else if (date === cur.date) {
        byUid.set(uid, { date, total: cur.total + qty }); // same day → accumulate batches
      }
    }
    return new Map(Array.from(byUid.entries()).map(([uid, v]) => [uid, v.total]));
  } catch { return new Map(); }
}

// ─── ANALOGS ────────────────────────────────────────────────────────────────

export async function getAnalogs(): Promise<any[]> {
  try {
    await ensureSheets(["Analogs"]);
    const [rows, materials] = await Promise.all([
      readRange("Analogs", "A2:D5000"),
      getAllRawMaterials(),
    ]);
    const nameMap = new Map(materials.map(m => [m.raw_uid, m.full_name]));
    return rows.filter(r => r[0] && r[1] && r[2]).map(r => ({
      id: r[0],
      raw_uid: r[1],
      analog_raw_uid: r[2],
      note: r[3] || "",
      name: nameMap.get(String(r[1])) || String(r[1]),
      analog_name: nameMap.get(String(r[2])) || String(r[2]),
    }));
  } catch { return []; }
}

export async function addAnalog(raw_uid: string, analog_raw_uid: string, note: string): Promise<void> {
  await ensureSheets(["Analogs"]);
  const id = `AN_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  await appendRows("Analogs", [[id, raw_uid, analog_raw_uid, note]]);
}

export async function deleteAnalog(id: string): Promise<void> {
  const rows = await readRange("Analogs", "A2:D5000");
  const filtered = rows.filter(r => r[0] !== id);
  await clearRange("Analogs", "A2:D5000");
  if (filtered.length) await writeRange("Analogs", `A2:D${filtered.length + 1}`, filtered);
  invalidateCache();
}

export async function getLatestLipStock(): Promise<Map<string, number>> {
  const rows = await readRange("LipStock", "A2:I5000");
  return sumLatestSnapshot(rows, r => {
    const free = parseNum(r[5]);
    return free > 0 ? free : Math.max(0, parseNum(r[3]) - parseNum(r[4]));
  });
}

export async function getLipStockList(): Promise<any[]> {
  const rows = await readRange("LipStock", "A2:I5000");
  return rows.filter(r => r[0]).map(r => ({
    snapshot_date: r[0], raw_uid: r[1], name_from_source: r[2],
    qty_on_hand: parseNum(r[3]), reserved_qty: parseNum(r[4]),
    free_qty: parseNum(r[5]), unit: r[6], source: r[7],
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
  return rows.filter(r => {
    if (!r[0]) return false;
    const status = String(r[6] || "").toLowerCase();
    // Прячем уже полученные и помеченные удалёнными (delete = мягкое, статус "удалено").
    return status !== "получено" && status !== "удалено";
  }).map(r => ({
    id: r[0], raw_uid: r[1], raw_name: r[2], qty: parseNum(r[3]),
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
      map.set(String(r[1]), cur + parseNum(r[3]));
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
      map.set(String(r[2]), cur + parseNum(r[6]));
    }
  }
  return map;
}

/**
 * Снимает потребность конкретного рецепта (откат): удаляет из листа Need все
 * строки с данным recipe_uid (col B / r[1]). Используется при удалении
 * документа-рецепта — количества «возвращаются» в доступный остаток.
 * Возвращает число удалённых строк.
 */
export async function deleteNeedByRecipe(recipe_uid: string): Promise<number> {
  const rows = await readRange("Need", "A2:H5000");
  const keepRows = rows.filter(r => String(r[1]) !== recipe_uid);
  const removed = rows.length - keepRows.length;
  if (removed === 0) return 0;
  await clearRange("Need", "A2:H5000");
  if (keepRows.length) await writeRange("Need", `A2:H${keepRows.length + 1}`, keepRows);
  return removed;
}

// ─── RECIPES ────────────────────────────────────────────────────────────────

/**
 * Статусы рецепта (лист Recipes, колонка L / индекс 11):
 *   IN_WORK   — рецепт пущен в работу, сырьё списано с остатков.
 *   CANCELLED — рецепт отменён, сырьё возвращается в общие остатки.
 *   DELETED   — рецепт отработан и удалён в архив; сырьё НЕ возвращается
 *               (остаётся списанным).
 * В «живые остатки» вычитается потребление рецептов в статусах IN_WORK и DELETED;
 * CANCELLED не вычитается (возврат сырья).
 */
export const RECIPE_STATUS = {
  PLAN: "план",
  IN_WORK: "в работе",
  ARCHIVED: "архив",
  CANCELLED: "отменён",
  DELETED: "удалён",
} as const;

/**
 * Статусы, при которых сырьё рецепта считается списанным со склада (вычитается
 * из живых остатков). По новой логике «План→Факт» сырьё резервируется уже на
 * этапе плана и не возвращается при выработке (архиве) — со склада возвращает
 * только ОТМЕНА. Поэтому списанными считаются ВСЕ статусы, кроме «отменён».
 * Легаси: «активен» = старый «в работе», «удалён» = старый архив.
 */
export const STOCK_CONSUMING_STATUSES = new Set<string>([
  RECIPE_STATUS.PLAN, RECIPE_STATUS.IN_WORK, RECIPE_STATUS.ARCHIVED,
  RECIPE_STATUS.DELETED, "активен",
]);

/**
 * Сигнал по остатку сырья для закупки/перевозки:
 *   critical — доступно < 0 (Полоцк+Липковская не покрывают) → СРОЧНО ЗАКУПАТЬ;
 *   transfer — суммарно хватает, но Полоцк в минусе → перевезти с Липковской;
 *   ok       — хватает на Полоцке.
 */
export function stockSignal(plant_qty: number, lip_qty: number, consumed: number): "critical" | "transfer" | "ok" {
  const available = round2(plant_qty + lip_qty - consumed);
  if (available < -1e-6) return "critical";
  if (round2(plant_qty - consumed) < -1e-6) return "transfer";
  return "ok";
}

export async function writeRecipe(recipe: {
  code: string; full_name: string; premix_name: string; date: string;
  concentration: number; batch_t: number; customer: string; period: string;
  quarter: string; file_name: string; base_batch_kg: number;
}): Promise<string> {
  const uid = `REC_${Date.now()}`;
  await appendRows("Recipes", [[
    uid, recipe.code, recipe.full_name, recipe.premix_name, recipe.date,
    recipe.concentration, recipe.batch_t, recipe.customer, recipe.period,
    recipe.quarter, recipe.file_name, RECIPE_STATUS.PLAN, recipe.base_batch_kg
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
  return rows
    .filter(r => r[0] && String(r[0]).startsWith("REC"))
    .map(r => ({
      recipe_uid: r[0], code: r[1], full_name: r[2], premix_name: r[3],
      date: r[4], batch_t: parseNum(r[6]), customer: r[7],
      status: String(r[11] || ""), file_name: r[10] || "",
      base_batch_kg: parseNum(r[12]) || 1000,
    }));
}

/**
 * Меняет выработку рецепта (тонны) и пересчитывает расход по всем его строкам
 * пропорционально (новый_расход = старый × новые_т / старые_т). Списание со
 * склада считается динамически из RecipeLines.consumption_kg, поэтому при
 * уменьшении выработки «лишнее» сырьё автоматически возвращается в остатки, а при
 * увеличении — дополнительно списывается (проверку достаточности делает роут ДО
 * вызова, под мьютексом). Обновляет Recipes: batch_t (G) и base_batch_kg (M).
 * Возвращает пересчитанные строки потребности (только сматченные позиции).
 */
export async function updateRecipeTons(recipe_uid: string, newTons: number): Promise<{
  found: boolean; oldBatchT: number; newBatchT: number;
  needLines: { raw_uid: string; net_qty: number }[];
}> {
  const recRows = await readRange("Recipes", "A2:M5000");
  let recIdx = -1;
  for (let i = 0; i < recRows.length; i++) {
    if (String(recRows[i][0]) === recipe_uid) { recIdx = i; break; }
  }
  if (recIdx < 0) return { found: false, oldBatchT: 0, newBatchT: 0, needLines: [] };

  // Канонический «старый объём» считаем так же, как роут проверки достаточности
  // (batch_t из col G, иначе base_batch_kg/1000, иначе 1т) — иначе проверка и
  // фактическое масштабирование разойдутся при расхождении G и M.
  const oldBaseKg = parseNum(recRows[recIdx][12]) || 1000;
  const oldBatchT = parseNum(recRows[recIdx][6]) || (oldBaseKg / 1000) || 1;
  const factor = oldBatchT > 0 ? newTons / oldBatchT : 0;
  const newBaseKg = round2(newTons * 1000);

  // Сначала пишем RecipeLines — это источник истины для списания/остатков.
  // Колонки batch_t/base_batch_kg в Recipes косметические, поэтому пишем их
  // после: при частичном сбое остатки уже согласованы с расходом.
  const lineRows = await readRange("RecipeLines", "A2:L5000");
  const needLines: { raw_uid: string; net_qty: number }[] = [];
  let changed = false;
  for (const row of lineRows) {
    if (String(row[1]) !== recipe_uid) continue;
    const newCons = round2(parseNum(row[7]) * factor);
    row[7] = newCons;
    changed = true;
    const rawUid = String(row[2] || "");
    if (rawUid && String(row[11] || "") === "matched" && newCons > 0) {
      needLines.push({ raw_uid: rawUid, net_qty: newCons });
    }
  }
  if (changed) await writeRange("RecipeLines", `A2:L${lineRows.length + 1}`, lineRows);

  await writeRange("Recipes", `G${recIdx + 2}:G${recIdx + 2}`, [[newTons]]);
  await writeRange("Recipes", `M${recIdx + 2}:M${recIdx + 2}`, [[newBaseKg]]);
  invalidateCache();
  return { found: true, oldBatchT, newBatchT: newTons, needLines };
}

/** Состав одного рецепта (лист RecipeLines, фильтр по recipe_uid в колонке B). */
export async function getRecipeLines(recipe_uid: string): Promise<any[]> {
  const rows = await readRange("RecipeLines", "A2:L5000");
  return rows
    .filter(r => String(r[1]) === recipe_uid)
    .map(r => ({
      id: r[0], recipe_uid: r[1], raw_uid: String(r[2] || ""),
      name_from_recipe: r[3], activity: r[4], input_pct: parseNum(r[5]),
      norm_g_per_t: parseNum(r[6]), consumption_kg: parseNum(r[7]),
      match_status: String(r[11] || ""),
    }));
}

/**
 * Меняет статус рецепта (лист Recipes, колонка L). Возвращает true, если рецепт
 * найден. Инвалидирует кэш — «живые остатки» сразу пересчитываются.
 */
export async function setRecipeStatus(recipe_uid: string, status: string): Promise<boolean> {
  const rows = await readRange("Recipes", "A2:M5000");
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === recipe_uid) {
      await writeRange("Recipes", `L${i + 2}:L${i + 2}`, [[status]]);
      invalidateCache();
      return true;
    }
  }
  return false;
}

/**
 * Суммирует потребление сырья (RecipeLines.consumption_kg, кол. H) по raw_uid
 * для рецептов, чей статус входит в `statuses`. Строки без raw_uid (позиции
 * завода / нераспознанные) не учитываются — со склада списать их нельзя.
 */
export async function getRecipeConsumptionByStatus(statuses: Set<string>): Promise<Map<string, number>> {
  const [recipeRows, lineRows] = await Promise.all([
    readRange("Recipes", "A2:M5000"),
    readRange("RecipeLines", "A2:L5000"),
  ]);
  const statusByRecipe = new Map<string, string>();
  for (const r of recipeRows) if (r[0]) statusByRecipe.set(String(r[0]), String(r[11] || ""));
  const map = new Map<string, number>();
  for (const r of lineRows) {
    const recUid = String(r[1] || "");
    const rawUid = String(r[2] || "");
    if (!recUid || !rawUid) continue;
    if (!statuses.has(statusByRecipe.get(recUid) || "")) continue;
    map.set(rawUid, round2((map.get(rawUid) || 0) + parseNum(r[7])));
  }
  return map;
}

/**
 * «Живые остатки» = (Полоцк + Липковская, последний снимок) − потребление
 * рецептов во всех статусах, КРОМЕ отменённых (STOCK_CONSUMING_STATUSES).
 * У отменённого рецепта сырьё вернулось, поэтому не вычитается. Товары в пути
 * (Inbound) НЕ включаются — их учитываем только при заказе сырья.
 */
export async function getLiveStock(): Promise<Array<{
  raw_uid: string; name: string; plant_qty: number; lip_qty: number;
  base: number; consumed: number; available: number;
  signal: "critical" | "transfer" | "ok";
}>> {
  const [plant, lip, consumed, catalog] = await Promise.all([
    getLatestPlantStock(),
    getLatestLipStock(),
    getRecipeConsumptionByStatus(STOCK_CONSUMING_STATUSES),
    getAllRawMaterials(),
  ]);
  const nameByUid = new Map(catalog.map(m => [m.raw_uid, m.full_name]));
  const uids = new Set<string>([...plant.keys(), ...lip.keys(), ...consumed.keys()]);
  const out = [];
  for (const uid of uids) {
    const plant_qty = plant.get(uid) || 0;
    const lip_qty = lip.get(uid) || 0;
    const base = round2(plant_qty + lip_qty);
    const cons = consumed.get(uid) || 0;
    out.push({
      raw_uid: uid, name: nameByUid.get(uid) || uid,
      plant_qty, lip_qty, base, consumed: cons, available: round2(base - cons),
      signal: stockSignal(plant_qty, lip_qty, cons),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
}

/**
 * Дефицит и атрибуция: по каждому сырью — остаток (Полоцк/Липковская), суммарное
 * списание, доступно, сигнал к закупке И разбивка по рецептам-потребителям
 * (матрица сырьё × рецепт), чтобы видеть, из чего сложился дефицит и перераспре-
 * делить объёмы. Учитываются только рецепты в «списывающих» статусах (всё, кроме
 * «отменён»). Возвращаются все сырьевые позиции, у которых есть остаток или
 * потребление; сортировка — дефицитные (critical, потом transfer) сверху.
 */
export async function getStockDeficit(): Promise<Array<{
  raw_uid: string; name: string; plant_qty: number; lip_qty: number;
  base: number; consumed: number; available: number;
  signal: "critical" | "transfer" | "ok";
  contributors: { recipe_uid: string; recipe_name: string; status: string; qty: number }[];
}>> {
  const [plant, lip, catalog, recipeRows, lineRows] = await Promise.all([
    getLatestPlantStock(),
    getLatestLipStock(),
    getAllRawMaterials(),
    readRange("Recipes", "A2:M5000"),
    readRange("RecipeLines", "A2:L5000"),
  ]);
  const nameByUid = new Map(catalog.map(m => [m.raw_uid, m.full_name]));
  const recInfo = new Map<string, { name: string; status: string }>();
  for (const r of recipeRows) {
    if (!r[0]) continue;
    recInfo.set(String(r[0]), {
      name: String(r[2] || r[1] || r[0]),
      status: String(r[11] || ""),
    });
  }
  // Потребление и вклад каждого рецепта по сырью (только списывающие статусы).
  const consumed = new Map<string, number>();
  const contribByRaw = new Map<string, Map<string, { recipe_name: string; status: string; qty: number }>>();
  for (const r of lineRows) {
    const recUid = String(r[1] || "");
    const rawUid = String(r[2] || "");
    if (!recUid || !rawUid) continue;
    const info = recInfo.get(recUid);
    if (!info || !STOCK_CONSUMING_STATUSES.has(info.status)) continue;
    const qty = parseNum(r[7]);
    if (!(qty > 0)) continue;
    consumed.set(rawUid, round2((consumed.get(rawUid) || 0) + qty));
    let byRec = contribByRaw.get(rawUid);
    if (!byRec) { byRec = new Map(); contribByRaw.set(rawUid, byRec); }
    const cur = byRec.get(recUid);
    if (cur) cur.qty = round2(cur.qty + qty);
    else byRec.set(recUid, { recipe_name: info.name, status: info.status, qty });
  }
  const uids = new Set<string>([...plant.keys(), ...lip.keys(), ...consumed.keys()]);
  const rank = { critical: 0, transfer: 1, ok: 2 } as const;
  const out = [];
  for (const uid of uids) {
    const plant_qty = plant.get(uid) || 0;
    const lip_qty = lip.get(uid) || 0;
    const base = round2(plant_qty + lip_qty);
    const cons = consumed.get(uid) || 0;
    const contributors = [...(contribByRaw.get(uid)?.entries() || [])]
      .map(([recipe_uid, c]) => ({ recipe_uid, ...c }))
      .sort((a, b) => b.qty - a.qty);
    out.push({
      raw_uid: uid, name: nameByUid.get(uid) || uid,
      plant_qty, lip_qty, base, consumed: cons, available: round2(base - cons),
      signal: stockSignal(plant_qty, lip_qty, cons), contributors,
    });
  }
  out.sort((a, b) =>
    rank[a.signal] - rank[b.signal] || a.name.localeCompare(b.name, "ru"));
  return out;
}

/**
 * Загруженные снимки остатков (по дате) для группового удаления. Возвращает по
 * одной записи на пару (лист, дата) с числом строк и суммой количества.
 */
export async function getStockSnapshots(): Promise<Array<{
  sheet: string; date: string; rows: number; qty: number; source: string;
}>> {
  const [plant, lip] = await Promise.all([
    readRange("PlantStock", "A2:G5000"),
    readRange("LipStock", "A2:I5000"),
  ]);
  const agg = new Map<string, { sheet: string; date: string; rows: number; qty: number; source: string }>();
  const add = (sheet: string, rows: any[][], qtyIdx: number, srcIdx: number) => {
    for (const r of rows) {
      const d = toIsoSnapshotDate(r[0]);
      if (!d) continue;
      const key = sheet + "|" + d;
      const cur = agg.get(key) || { sheet, date: d, rows: 0, qty: 0, source: String(r[srcIdx] || "") };
      cur.rows++;
      cur.qty = round2(cur.qty + parseNum(r[qtyIdx]));
      if (!cur.source && r[srcIdx]) cur.source = String(r[srcIdx]);
      agg.set(key, cur);
    }
  };
  add("PlantStock", plant, 3, 5);
  add("LipStock", lip, 3, 7);
  return Array.from(agg.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/** Удаляет все строки снимка (sheet, date). Возвращает число удалённых строк. */
export async function deleteStockSnapshot(sheet: string, date: string): Promise<number> {
  if (sheet !== "PlantStock" && sheet !== "LipStock") {
    throw new Error(`Недопустимый лист остатков: ${sheet}`);
  }
  const range = sheet === "PlantStock" ? "A2:G5000" : "A2:I5000";
  const lastCol = sheet === "PlantStock" ? "G" : "I";
  const rows = await readRange(sheet, range);
  const target = toIsoSnapshotDate(date) || String(date || "").trim();
  const keep = rows.filter(r => toIsoSnapshotDate(r[0]) !== target);
  const removed = rows.length - keep.length;
  if (removed === 0) return 0;
  await clearRange(sheet, range);
  if (keep.length) await writeRange(sheet, `A2:${lastCol}${keep.length + 1}`, keep);
  invalidateCache();
  return removed;
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
