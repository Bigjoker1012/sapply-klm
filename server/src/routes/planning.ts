/**
 * Планирование закупок по сырью. Страница «Планирование закупок».
 *   GET   /api/planning            — список SKU + кол-во сегодня + настройки
 *   PATCH /api/planning/:raw_uid   — сохранить коэффициент / ручной ввод / расход
 *
 * «Кол-во сегодня» = остатки Полоцк + Липковская + в пути (та же логика, что и
 * на дашборде). Среднемесячный расход авто НЕ считаем (нет истории расхода) —
 * только ручной ввод; иначе поле пустое.
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { purchasePlanSetting } from "../db/schema";
import { requireAuth } from "../auth/middleware";

const router = Router();
router.use(requireAuth);

interface PlanningRow {
  raw_uid: string;
  name: string;
  unit: string;
  qty_today: number;
  /** Среднемес. расход: число при ручном вводе, иначе null (авто пока нет) */
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = (await db.execute(sql`
      SELECT
        s.code AS raw_uid,
        s.name AS name,
        s.unit AS unit,
        COALESCE((
          SELECT SUM(b.current_qty_kg) FROM batch b
          JOIN warehouse w ON w.id = b.warehouse_id
          WHERE b.sku_id = s.id AND b.status = 'active' AND w.code = 'POLOTSK'
        ), 0)
        + COALESCE((
          SELECT SUM(b.current_qty_kg) FROM batch b
          JOIN warehouse w ON w.id = b.warehouse_id
          WHERE b.sku_id = s.id AND b.status = 'active' AND w.code = 'LIPKOV'
        ), 0)
        + COALESCE((
          SELECT SUM(it.qty_kg) FROM in_transit it
          WHERE it.sku_id = s.id AND it.status IN ('at_supplier','in_transit','customs')
        ), 0)                                     AS qty_today,
        p.coefficient                             AS coefficient,
        p.manual_input                            AS manual_input,
        p.manual_avg_usage                        AS manual_avg_usage
      FROM sku s
      LEFT JOIN purchase_plan_setting p ON p.sku_code = s.code
      WHERE s.active = true
      ORDER BY s.name
    `)).rows as Array<{
      raw_uid: string; name: string; unit: string; qty_today: number | string;
      coefficient: number | null; manual_input: boolean | null; manual_avg_usage: number | null;
    }>;

    const result: PlanningRow[] = rows.map(r => {
      const manual_input = r.manual_input === true;
      const manual_avg_usage = r.manual_avg_usage ?? null;
      return {
        raw_uid: r.raw_uid,
        name: r.name,
        unit: r.unit,
        qty_today: Number(r.qty_today) || 0,
        avg_monthly_usage: manual_input ? manual_avg_usage : null,
        coefficient: r.coefficient ?? 1,
        manual_input,
        manual_avg_usage,
      };
    });
    res.json(result);
  } catch (err: any) {
    console.error("[planning/get]", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:raw_uid", async (req: Request, res: Response) => {
  try {
    const skuCode = req.params.raw_uid;
    const body = req.body ?? {};

    const insert: Record<string, any> = { skuCode };
    const set: Record<string, any> = { updatedAt: new Date().toISOString() };

    if (body.coefficient !== undefined) {
      const c = Math.min(1, Math.max(0.1, Number(body.coefficient)));
      if (!Number.isFinite(c)) return res.status(400).json({ error: "coefficient некорректен" });
      insert.coefficient = c; set.coefficient = c;
    }
    if (body.manual_input !== undefined) {
      const mi = !!body.manual_input;
      insert.manualInput = mi; set.manualInput = mi;
    }
    if (body.manual_avg_usage !== undefined) {
      const raw = body.manual_avg_usage;
      const v = raw === null || raw === "" ? null : Math.max(0, Number(raw));
      if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: "manual_avg_usage некорректен" });
      insert.manualAvgUsage = v; set.manualAvgUsage = v;
    }

    await db.insert(purchasePlanSetting).values(insert).onConflictDoUpdate({
      target: purchasePlanSetting.skuCode,
      set,
    });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[planning/patch]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
