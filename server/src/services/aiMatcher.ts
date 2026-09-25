import OpenAI from "openai";
import { isApprovalText, recipeFullName } from "./excelParser";

// Ленивая инициализация: без ключа конструктор OpenAI бросает исключение,
// что сломало бы фолбэк «нет ключа → OCR». Создаём клиент только при первом
// реальном вызове, а вызывающий код предварительно проверяет наличие ключа.
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export interface AiSuggestion {
  original_text: string;
  suggested_raw_uid: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Ask OpenAI to match vendor product names to known raw materials.
 * @param items - array of vendor strings from КД/ЗПП
 * @param rawMaterials - array of {raw_uid, full_name} from Syryo sheet
 */
export async function suggestMatches(
  items: string[],
  rawMaterials: { raw_uid: string; full_name: string }[]
): Promise<AiSuggestion[]> {
  if (!items.length) return [];

  const catalog = rawMaterials
    .map(m => `${m.raw_uid}: ${m.full_name}`)
    .join("\n");

  const itemsList = items.map((t, i) => `${i + 1}. "${t}"`).join("\n");

  const systemPrompt = `Ты эксперт по кормовым добавкам и премиксам для животноводства. 
Тебе дан справочник сырья (id: название) и список коммерческих названий товаров от поставщика.
Твоя задача — сопоставить каждое коммерческое название с наиболее подходящим сырьём из справочника.

Справочник сырья:
${catalog}

Правила:
- Отвечай ТОЛЬКО валидным JSON-объектом вида {"results": [ ... ]} без лишнего текста
- В массиве results для каждого элемента укажи поля: original_text, suggested_raw_uid (или null если нет совпадения), confidence ("high"/"medium"/"low"), reason (кратко по-русски)
- "high" — очевидное совпадение (витамин А = вит А 1000, биоплекс марганец = биоплекс Mn)
- "medium" — вероятное совпадение (разные формы одного вещества)
- "low" — предположение
- null если это не сырьё (упаковка, мешки, оборудование и т.д.)`;

  const userPrompt = `Сопоставь следующие коммерческие названия со справочником:\n${itemsList}`;

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return items.map(t => ({
      original_text: t,
      suggested_raw_uid: null,
      confidence: "low" as const,
      reason: "Ошибка разбора ответа ИИ",
    }));
  }

  // response_format=json_object вынуждает модель вернуть объект-обёртку, но ключ
  // может быть любым (results/matches/данные/…). Сначала пробуем results,
  // затем берём первый массив из значений объекта.
  const arr: AiSuggestion[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
    ? parsed.results
    : (Object.values(parsed ?? {}).find(v => Array.isArray(v)) as AiSuggestion[] | undefined) ?? [];

  return arr.map((s: any) => ({
    original_text: s.original_text || "",
    suggested_raw_uid: s.suggested_raw_uid || null,
    confidence: s.confidence || "low",
    reason: s.reason || "",
  }));
}

// ─── Распознавание рецепта-картинки через vision-модель ──────────────────────

export interface AiRecipeRow {
  rawName: string;
  percentage: number;
  quantityPerTon: number;
  // >0 → наша позиция; 0 → позиция завода; null → колонки цены нет (неизвестно).
  pricePerKg: number | null;
}

export interface AiRecipe {
  code: string;
  name: string;
  date: string;
  batchKg: number;
  rows: AiRecipeRow[];
}

/**
 * Извлекает состав премикса из изображения(й) бланка «РЕЦЕПТ ПРЕМИКСА» (1С КХП)
 * с помощью vision-модели. Нужно для PDF БЕЗ текстового слоя (текст вшит кривыми),
 * где tesseract на плотной многоколоночной таблице ненадёжен.
 *
 * Возвращает null, если ключа нет, ответ не распарсился или строк не найдено —
 * тогда вызывающий код уходит в tesseract-фолбэк.
 */
export async function parseRecipeWithVision(imagesB64: string[]): Promise<AiRecipe | null> {
  if (!process.env.OPENAI_API_KEY || !imagesB64.length) return null;

  const systemPrompt = `Ты извлекаешь состав премикса из изображения бланка «РЕЦЕПТ ПРЕМИКСА» Полоцкого комбината хлебопродуктов (выгрузка 1С).
Слева — таблица «Состав рецепта» с колонками: Наименование | Активн. | % ввода | Норма ввода г/т | Расход сырья кг | Цена | Стоимость.
Справа — блоки «Качество рецепта» и «Плановая калькуляция»: их ПОЛНОСТЬЮ игнорируй.

Верни СТРОГО валидный JSON-объект вида:
{"code":"...","name":"...","date":"ДД.ММ.ГГГГ","batchKg":число,"rows":[{"rawName":"...","percentage":число,"quantityPerTon":число,"pricePerKg":число}]}

Правила:
- code — код рецепта (например «Д-П60-3/Б20/ПЛЦ-164», «П60-3», «ПКР-2», «КК-61-1/Б20/ПЛЦ-178»).
- name — текст после слова «Для» (например «ВЫСОКОПРОДУКТИВНЫХ КОРОВ, СТОЙЛОВЫЙ ПЕРИОД»).
- date — значение «Дата печати».
- batchKg — «Выработка» в тоннах × 1000 (1 т → 1000).
- rows — КАЖДАЯ строка-компонент таблицы «Состав рецепта».
    rawName — наименование РОВНО как напечатано, включая код-префикс (например «В1_ВИТАМИН А КЛМ (Апсавит А1000)»).
    percentage — число из колонки «% ввода».
    quantityPerTon — число из колонки «Расход сырья, кг».
    pricePerKg — число из колонки «Цена» (цена за 1 кг). Верни 0 ТОЛЬКО если в ячейке явно напечатан 0. Если ячейка пустая ИЛИ колонки цены в таблице нет — верни null (цена неизвестна).
- НЕ включай строки-подытоги: «Витамины-итого», «Микроэлементы-итого», «ИТОГО», «ВСЕГО».
- Десятичный разделитель — запятую — верни как точку (3,360 → 3.36), пробелы-разделители тысяч убери (14 474 → 14474).
- Только JSON, без пояснений и текста вокруг.`;

  const content: any[] = [
    { type: "text", text: "Извлеки состав рецепта из изображения(й) бланка." },
  ];
  for (const b64 of imagesB64) {
    content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } });
  }

  const response = await getClient().chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const rowsRaw = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const rows: AiRecipeRow[] = rowsRaw
    .map((r: any) => ({
      rawName: String(r.rawName || "").trim(),
      percentage: Number(r.percentage) || 0,
      quantityPerTon: Number(r.quantityPerTon) || 0,
      pricePerKg: r.pricePerKg == null ? null : Number(r.pricePerKg) || 0,
    }))
    .filter((r: AiRecipeRow) => r.rawName.length >= 2 && (r.percentage > 0 || r.quantityPerTon > 0));

  if (!rows.length) return null;

  return {
    code: String(parsed.code || "").trim(),
    name: isApprovalText(String(parsed.name || ""))
      ? recipeFullName(String(parsed.code || "Рецепт"))
      : (String(parsed.name || "").trim() || recipeFullName(String(parsed.code || "Рецепт"))),
    date: String(parsed.date || "").trim() || new Date().toISOString().split("T")[0],
    batchKg: Number(parsed.batchKg) || 1000,
    rows,
  };
}
