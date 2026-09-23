/**
 * Доктор Саппи — AI-диагност Supply KLM.
 * Двухэтапный агент:
 *   1) MiMo выбирает и вызывает инструменты
 *   2) MiMo анализирует результаты → человеческий вывод
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const router = Router();
router.use(requireAuth);

const MIMO_API_URL = process.env.MIMO_API_URL || "https://api.xiaomimimo.com/v1";
const MIMO_API_KEY = process.env.MIMO_API_KEY || "";
const MIMO_MODEL = process.env.MIMO_MODEL || "mimo-v2.5-pro";

// ── Инструменты ────────────────────────────────────────────────────────

interface DiagnosticTool { (...args: any[]): Promise<any>; }

const diagnosticTools: Record<string, DiagnosticTool> = {
  check_health: async () => {
    try {
      const res = await fetch("http://localhost:3001/api/health");
      return await res.json();
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_api: async (endpoint: string) => {
    try {
      const res = await fetch("http://localhost:3001" + endpoint);
      return { httpStatus: res.status, ok: res.ok };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_database: async () => {
    try {
      const tables = await db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      return { status: "connected", tables: tables.rows.map((r: any) => r.table_name) };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_table: async (tableName: string) => {
    try {
      if (!tableName) return { error: "table name required" };
      const count = await db.execute(sql`SELECT COUNT(*) as cnt FROM ${sql.identifier(tableName)}`);
      return { count: (count.rows[0] as any).cnt };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_stock: async () => {
    try {
      const result = await db.execute(
        sql`SELECT snapshot_date, COUNT(*) as items FROM stock_snapshot GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 5`
      );
      return { snapshots: result.rows };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_recipes: async () => {
    try {
      const stats = await db.execute(sql`SELECT status, COUNT(*) as cnt FROM recipe GROUP BY status`);
      return { stats: stats.rows };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_batches: async () => {
    try {
      const stats = await db.execute(
        sql`SELECT COUNT(*) as total, SUM(CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END) as no_expiry FROM lip_batch`
      );
      return { stats: stats.rows[0] };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_unresolved: async () => {
    try {
      const items = await db.execute(
        sql`SELECT text, source_type, qty FROM unresolved_item WHERE resolved = false LIMIT 10`
      );
      return { items: items.rows };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  check_sku_count: async () => {
    try {
      const result = await db.execute(sql`SELECT COUNT(*) as total FROM sku WHERE active = true`);
      return { total: (result.rows[0] as any).total };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
  search_recipe_by_sku: async (skuCode: string) => {
    try {
      if (!skuCode) return { error: "sku_code required" };
      const result = await db.execute(sql`
        SELECT r.recipe_uid, r.code, r.full_name, r.status, r.batch_t,
               ri.sku_id, ri.dose_kg_per_t,
               s.code as sku_code, s.name as sku_name
        FROM recipe r
        JOIN recipe_item ri ON ri.recipe_id = r.id
        JOIN sku s ON ri.sku_id = s.id
        WHERE s.code = ${skuCode}
        ORDER BY r.status, r.recipe_uid
      `);
      return { recipes: result.rows };
    } catch (e: any) { return { status: "error", error: e.message }; }
  },
};

// ── Промпты ────────────────────────────────────────────────────────────

const STEP1_PROMPT = `Ты — Доктор Саппи, AI-диагност приложения Supply KLM.

Твоя задача — вызвать нужные инструменты для проверки состояния системы.

Доступные инструменты (вызывай в формате [TOOL: имя(параметры)]):
1. check_health() — здоровье сервера
2. check_api(endpoint) — проверить API endpoint
3. check_database() — БД и список таблиц
4. check_table(tableName) — проверить таблицу
5. check_stock() — снимки остатков
6. check_recipes() — статистика рецептов
7. search_recipe_by_sku(sku_code) — найти рецепты с конкретным сырьём
8. check_batches() — партии и сроки годности
9. check_unresolved() — нераспознанные позиции
10. check_sku_count() — количество SKU

ПРАВИЛА:
- Вызывай ТОЛЬКО инструменты, НЕ анализируй результаты
- НЕ пиши итоговый отчёт — это будет отдельным шагом
- НЕ пиши "Вот результаты:" или подобное — просто вызови инструменты`;

const STEP2_PROMPT = `Ты — Доктор Саппи, AI-диагност приложения Supply KLM.

Тебе переданы результаты диагностики. Проанализируй их и сформируй КОРОТКИЙ человеческий вывод на русском языке.

ФОРМАТ ОТВЕТА:
1. 1-3 предложения с выводом
2. Если всё ОК — просто скажи "Проверила. Всё работает нормально." или аналогично
3. Если проблема — назови конкретную проблему простым языком
4. Используй эмодзи: 🟢 ОК, 🟡 внимание, 🔴 проблема
5. НЕ показывай JSON
6. НЕ показывай технические данные
7. НЕ вызывай инструменты повторно
8. Ответ должен быть КОРОТКИМ — 2-5 предложений`;

// ── Вспомогательные функции ────────────────────────────────────────────

async function callMimo(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(MIMO_API_URL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MIMO_API_KEY },
    body: JSON.stringify({ model: MIMO_MODEL, messages, temperature: 0.3, max_tokens: 1500 }),
  });
  if (!res.ok) throw new Error("MiMo API error: " + res.status);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || "Нет ответа";
}

function parseToolCalls(text: string): { tool: string; args: string[] }[] {
  const calls: { tool: string; args: string[] }[] = [];
  const pattern = /\[TOOL:\s*(\w+)\(([^)]*)\)\]/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const args = m[2] ? m[2].split(",").map((a: string) => a.trim().replace(/['"]/g, "")) : [];
    calls.push({ tool: m[1], args });
  }
  return calls;
}

// ── Маршрут ────────────────────────────────────────────────────────────

router.post("/chat", async (req: Request, res: Response) => {
  const { message, history } = req.body;

  if (!message) return res.status(400).json({ error: "Сообщение обязательно" });
  if (!MIMO_API_KEY) return res.status(500).json({ error: "MIMO_API_KEY не настроен" });

  const t0 = Date.now();
  try {
    // ── Шаг 1: Модель выбирает инструменты ──
    const step1Messages = [
      { role: "system", content: STEP1_PROMPT },
      ...(history || []),
      { role: "user", content: message }
    ];

    const step1Response = await callMimo(step1Messages);
    const t1 = Date.now();
    console.log(`[diagnost] Step1: ${t1 - t0}ms`);

    // ── Выполнение инструментов ──
    const toolCalls = parseToolCalls(step1Response);
    const toolResults: Record<string, any> = {};

    for (const call of toolCalls) {
      const tool = (diagnosticTools as any)[call.tool];
      if (tool) {
        try {
          toolResults[call.tool] = await tool(...call.args);
        } catch (e: any) {
          toolResults[call.tool] = { error: e.message };
        }
      }
    }
    const t2 = Date.now();
    console.log(`[diagnost] Tools: ${t2 - t1}ms, tools: ${Object.keys(toolResults).join(", ")}`);

    // ── Шаг 2: Модель анализирует результаты ──
    const resultsText = Object.entries(toolResults)
      .map(([name, result]) => `${name}:\n${JSON.stringify(result, null, 2)}`)
      .join("\n\n");

    const step2Messages = [
      { role: "system", content: STEP2_PROMPT },
      { role: "user", content: `Запрос пользователя: ${message}\n\nРезультаты диагностики:\n${resultsText}` }
    ];

    const step2Response = await callMimo(step2Messages);
    const t3 = Date.now();
    console.log(`[diagnost] Step2: ${t3 - t2}ms`);

    // ── Ответ: человеческий вывод ──
    const cleanMessage = step2Response.replace(/\[TOOL:\s*\w+\([^)]*\)\]/g, "").trim();

    res.json({
      message: cleanMessage,
      toolCalls,
      toolResults,
      model: MIMO_MODEL,
      timings: { step1: t1 - t0, tools: t2 - t1, analysis: t3 - t2, total: t3 - t0 },
    });
  } catch (err: any) {
    console.error("[diagnost/chat]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const results: Record<string, any> = {};
    for (const [name, fn] of Object.entries(diagnosticTools)) {
      try { results[name] = await fn(); } catch (e: any) { results[name] = { error: e.message }; }
    }
    res.json({ timestamp: new Date().toISOString(), checks: results });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
