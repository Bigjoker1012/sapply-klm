/**
 * Планирование закупок по сырью. Страница «Планирование закупок».
 *   GET   /api/planning            — список SKU + кол-во сегодня + настройки
 *   PATCH /api/planning/:raw_uid   — сохранить коэффициент / ручной ввод / расход
 *
 * «Кол-во сегодня» = остатки Полоцк + Липковская + в пути − потребность по
 * рецептам в списывающих статусах (план/в работе; выработанные/архив уже учтены
 * в новом остатке склада — см. STOCK_CONSUMING_STATUSES). Среднемесячный расход
 * авто НЕ считаем (нет истории расхода) — только ручной ввод; иначе поле пустое.
 * coefficient — «ручной коэф-т» (запас под срок поставки): 1.0–2.0, по умолч. 1.
 * Статус считается на СЕРВЕРЕ единым модулем services/planningStatus.ts (тот же,
 * что светофор «Главной»): коэф-т потребности = наличие/ср.расход, итог = коэф-т
 * потребности / ручной коэф-т; >1.5 норма, 1–1.5 контроль, 0.6–1 закупка,
 * <0.6 срочная закупка. Без ручного расхода статус не считается.
 */
import { Router, Request, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { db } from "../db/client";
import { requireAuth } from "../auth/middleware";
import { computePlanningRows } from "../services/planningStatus";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await computePlanningRows();
    res.json(rows);
  } catch (err: any) {
    console.warn("[planning/get] fallback:", err.message);
    res.json([]);
  }
});

router.patch("/:raw_uid", async (req: Request, res: Response) => {
  try {
    const skuCode = req.params.raw_uid;
    const body = req.body ?? {};

    const fields: { coefficient?: number; manualInput?: boolean; manualAvgUsage?: number | null } = {};

    if (body.coefficient !== undefined) {
      const n = Number(body.coefficient);
      if (!Number.isFinite(n)) return res.status(400).json({ error: "coefficient некорректен" });
      // Ручной коэф-т (запас под срок поставки): 1.0–2.0, по умолчанию 1.
      fields.coefficient = Math.min(2, Math.max(1, n));
    }
    if (body.manual_input !== undefined) {
      fields.manualInput = !!body.manual_input;
    }
    if (body.manual_avg_usage !== undefined) {
      const raw = body.manual_avg_usage;
      const v = raw === null || raw === "" ? null : Math.max(0, Number(raw));
      if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: "manual_avg_usage некорректен" });
      fields.manualAvgUsage = v;
    }

    // Гарантируем строку с дефолтами, затем точечно обновляем переданные поля.
    await db.execute(sql`
      INSERT INTO purchase_plan_setting (sku_code) VALUES (${skuCode})
      ON CONFLICT (sku_code) DO NOTHING
    `);

    const sets: SQL[] = [
      sql`updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    ];
    if (fields.coefficient !== undefined) sets.push(sql`coefficient = ${fields.coefficient}`);
    if (fields.manualInput !== undefined) sets.push(sql`manual_input = ${fields.manualInput}`);
    if (fields.manualAvgUsage !== undefined) sets.push(sql`manual_avg_usage = ${fields.manualAvgUsage}`);

    await db.execute(sql`
      UPDATE purchase_plan_setting SET ${sql.join(sets, sql`, `)}
      WHERE sku_code = ${skuCode}
    `);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[planning/patch]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
