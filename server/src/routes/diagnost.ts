import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const router = Router();
router.use(requireAuth);

const MIMO_API_URL = process.env.MIMO_API_URL || "https://token-plan-sgp.xiaomimimo.com/v1";
const MIMO_API_KEY = process.env.MIMO_API_KEY || "";
const MIMO_MODEL = process.env.MIMO_MODEL || "mimo-v2.5-pro";

interface DiagnosticTool {
  (...args: any[]): Promise<any>;
}

const diagnosticTools: Record<string, DiagnosticTool> = {
  check_health: async () => {
    try {
      const res = await fetch("http://localhost:3001/api/health");
      return await res.json();
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_api: async (endpoint: string) => {
    try {
      const res = await fetch("http://localhost:3001" + endpoint);
      return { httpStatus: res.status, ok: res.ok };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_database: async () => {
    try {
      const tables = await db.execute(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      return { status: "connected", tables: tables.rows.map((r: any) => r.table_name) };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_table: async (tableName: string) => {
    try {
      if (!tableName) return { error: "table name required" };
      const count = await db.execute(sql`SELECT COUNT(*) as cnt FROM ${sql.identifier(tableName)}`);
      return { count: (count.rows[0] as any).cnt };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_stock: async () => {
    try {
      const result = await db.execute(
        sql`SELECT snapshot_date, COUNT(*) as items FROM stock_snapshot GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 5`
      );
      return { snapshots: result.rows };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_recipes: async () => {
    try {
      const stats = await db.execute(sql`SELECT status, COUNT(*) as cnt FROM recipe GROUP BY status`);
      return { stats: stats.rows };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  search_recipe_by_sku: async (skuCode: string) => {
    try {
      if (!skuCode) return { error: "sku_code required (e.g. RAW_036)" };
      const result = await db.execute(sql`
        SELECT r.name as recipe_name, r.status, r.code as recipe_code,
               ri.consumption_kg, ri.dose_kg_per_t, ri.norm_g_per_t,
               s.code as sku_code, s.name as sku_name
        FROM recipe_item ri
        JOIN recipe r ON ri.recipe_id = r.id
        JOIN sku s ON ri.sku_id = s.id
        WHERE s.code = ${skuCode}
        ORDER BY r.status, r.name
      `);
      if (result.rows.length === 0) {
        return { found: false, message: `SKU ${skuCode} not found in any recipe` };
      }
      const active = result.rows.filter((r: any) => r.status === 'active');
      const archived = result.rows.filter((r: any) => r.status === 'archived');
      return {
        found: true,
        total: result.rows.length,
        active: active.length,
        archived: archived.length,
        recipes: result.rows.map((r: any) => ({
          name: r.recipe_name,
          code: r.recipe_code,
          status: r.status,
          consumption_kg: r.consumption_kg,
          dose_kg_per_t: r.dose_kg_per_t,
        })),
      };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_batches: async () => {
    try {
      const stats = await db.execute(
        sql`SELECT COUNT(*) as total, SUM(CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END) as no_expiry FROM lip_batch`
      );
      return { stats: stats.rows[0] };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_unresolved: async () => {
    try {
      const items = await db.execute(
        sql`SELECT text, source_type, qty FROM unresolved_item WHERE resolved = false LIMIT 10`
      );
      return { items: items.rows };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },

  check_sku_count: async () => {
    try {
      const result = await db.execute(sql`SELECT COUNT(*) as total FROM sku WHERE active = true`);
      return { total: (result.rows[0] as any).total };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  },
};

const SYSTEM_PROMPT = `Ты — Доктор Саппи, AI-диагност приложения Supply KLM.

Твоя задача — диагностировать проблемы в работе Supply KLM.

Доступные инструменты (вызывай в формате [TOOL: имя(параметры)]):
1. check_health() - проверить здоровье сервера
2. check_api(endpoint) - проверить API endpoint
3. check_database() - проверить БД и список таблиц
4. check_table(tableName) - проверить таблицу
5. check_stock() - проверить снимки остатков
6. check_recipes() - статистика рецептов
7. search_recipe_by_sku(sku_code) - найти рецепты, содержащие конкретное сырьё (например: search_recipe_by_sku(RAW_036))
8. check_batches() - партии и сроки годности
9. check_unresolved() - нераспознанные позиции
10. check_sku_count() - количество SKU

ВАЖНО: Для поиска сырья в рецептах ВСЕГДА используй search_recipe_by_sku(), а НЕ пытайся читать таблицу напрямую.

Правила:
- Всегда начинай с проверки состояния
- Используй инструменты для фактов
- Объясняй простым языком
- Формируй ТЗ если нужно исправление
- Никогда не изменяй данные`;

router.post("/chat", async (req: Request, res: Response) => {
  const { message, history } = req.body;

  if (!message) return res.status(400).json({ error: "Сообщение обязательно" });
  if (!MIMO_API_KEY) return res.status(500).json({ error: "MIMO_API_KEY не настроен" });

  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message }
    ];

    const mimoRes = await fetch(MIMO_API_URL + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + MIMO_API_KEY,
      },
      body: JSON.stringify({ model: MIMO_MODEL, messages, temperature: 0.3, max_tokens: 2000 }),
    });

    if (!mimoRes.ok) {
      const errText = await mimoRes.text();
      return res.status(500).json({ error: "MiMo API error: " + mimoRes.status });
    }

    const mimoData = await mimoRes.json() as any;
    const assistantMessage = mimoData.choices?.[0]?.message?.content || "Нет ответа";

    // Parse tool calls from response
    const toolCalls: { tool: string; args: string[] }[] = [];
    const toolPattern = /\[TOOL:\s*(\w+)\(([^)]*)\)\]/g;
    let match;
    while ((match = toolPattern.exec(assistantMessage)) !== null) {
      const toolName = match[1];
      const args = match[2] ? match[2].split(",").map((a: string) => a.trim().replace(/['"]/g, "")) : [];
      toolCalls.push({ tool: toolName, args });
    }

    // Execute tool calls
    const toolResults: Record<string, any> = {};
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const tool = (diagnosticTools as any)[call.tool];
      if (tool) {
        // Use unique key: tool_name + args to avoid overwriting duplicate calls
        const key = call.args.length > 0 ? `${call.tool}(${call.args.join(",")})` : `${call.tool}_${i}`;
        try {
          toolResults[key] = await tool(...call.args);
        } catch (e: any) {
          toolResults[key] = { error: e.message };
        }
      }
    }

    res.json({ message: assistantMessage, toolCalls, toolResults, model: MIMO_MODEL });
  } catch (err: any) {
    console.error("[diagnost/chat]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const results: Record<string, any> = {};
    for (const [name, fn] of Object.entries(diagnosticTools)) {
      try {
        results[name] = await fn();
      } catch (e: any) {
        results[name] = { error: e.message };
      }
    }
    res.json({ timestamp: new Date().toISOString(), checks: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
