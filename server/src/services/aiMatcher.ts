import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
- Отвечай ТОЛЬКО валидным JSON-массивом без лишнего текста
- Для каждого элемента укажи поля: original_text, suggested_raw_uid (или null если нет совпадения), confidence ("high"/"medium"/"low"), reason (кратко по-русски)
- "high" — очевидное совпадение (витамин А = вит А 1000, биоплекс марганец = биоплекс Mn)
- "medium" — вероятное совпадение (разные формы одного вещества)
- "low" — предположение
- null если это не сырьё (упаковка, мешки, оборудование и т.д.)`;

  const userPrompt = `Сопоставь следующие коммерческие названия со справочником:\n${itemsList}`;

  const response = await client.chat.completions.create({
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

  const arr: AiSuggestion[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.matches)
    ? parsed.matches
    : Array.isArray(parsed.results)
    ? parsed.results
    : [];

  return arr.map((s: any) => ({
    original_text: s.original_text || "",
    suggested_raw_uid: s.suggested_raw_uid || null,
    confidence: s.confidence || "low",
    reason: s.reason || "",
  }));
}
