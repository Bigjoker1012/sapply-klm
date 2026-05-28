/**
 * Рецепты премиксов. Эндпоинты:
 *   GET /api/recipes            — список (для выбора в UI)
 *   GET /api/recipes/:id/lines  — состав конкретного рецепта
 *
 * Источник данных: новая SQLite-схема (recipe, recipe_item, sku).
 * Форма ответа сохранена под текущий фронт (поля raw_uid, name_from_recipe и т.п.).
 *
 * TODO: добавить requireAuth, когда фронт начнёт слать Bearer-токен.
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  try {
    const rows = db.all(sql`
      SELECT
        r.id            AS recipe_uid,
        r.code          AS code,
        r.name          AS full_name,
        r.name          AS premix_name,
        r.active_from   AS date,
        r.target_animal AS customer,
        r.status        AS status,
        r.version       AS version
      FROM recipe r
      WHERE r.status IN ('active','draft')
      ORDER BY r.code, r.version DESC
    `) as Array<{
      recipe_uid: number; code: string; full_name: string; premix_name: string;
      date: string | null; customer: string; status: string; version: number;
    }>;
    // batch_t / base_batch_kg — не часть новой схемы (там дозировка через
    // production_plan.qty_t и recipe_item.dose_kg_per_t). Возвращаем дефолт 1т,
    // чтобы фронтовая форма пересчёта работала.
    res.json(rows.map(r => ({
      ...r,
      recipe_uid: String(r.recipe_uid),
      batch_t: 1,
      base_batch_kg: 1000,
    })));
  } catch (err: any) {
    console.error("[recipes/list]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:uid/lines", (req: Request, res: Response) => {
  const recipeId = parseInt(req.params.uid, 10);
  if (!Number.isFinite(recipeId)) {
    return res.status(400).json({ error: "Некорректный recipe_uid" });
  }
  try {
    const rows = db.all(sql`
      SELECT
        ri.id              AS id,
        ri.recipe_id       AS recipe_uid,
        s.code             AS raw_uid,
        s.name             AS name_from_recipe,
        s.category         AS activity,
        ri.dose_kg_per_t   AS dose_kg_per_t,
        ri.sort_order      AS sort_order,
        ri.note            AS note
      FROM recipe_item ri
      JOIN sku s ON s.id = ri.sku_id
      WHERE ri.recipe_id = ${recipeId}
      ORDER BY ri.sort_order, ri.id
    `) as Array<{
      id: number; recipe_uid: number; raw_uid: string; name_from_recipe: string;
      activity: string; dose_kg_per_t: number; sort_order: number; note: string | null;
    }>;
    // Маппинг новых полей в форму, ожидаемую фронтом:
    //   dose_kg_per_t (новое) → norm_g_per_t = dose_kg_per_t * 1000,
    //                           consumption_kg на 1 т = dose_kg_per_t.
    //   input_pct и match_status в новой схеме не нужны (рецепт уже сматчен
    //   на SKU при создании), отдаём заглушку.
    res.json(rows.map(r => ({
      id: r.id,
      recipe_uid: String(r.recipe_uid),
      raw_uid: r.raw_uid,
      name_from_recipe: r.name_from_recipe,
      activity: r.activity,
      input_pct: 0,
      norm_g_per_t: r.dose_kg_per_t * 1000,
      consumption_kg: r.dose_kg_per_t,
      match_status: "matched",
    })));
  } catch (err: any) {
    console.error("[recipes/lines]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
