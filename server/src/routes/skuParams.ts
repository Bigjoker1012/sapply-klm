/**
 * Параметры закупки SKU. ТЗ 4.8.3.
 *   GET   /api/sku-params          — все параметры закупки активных SKU
 *   PUT   /api/sku-params/:code    — обновить параметры одного SKU
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { requireAuth } from "../auth/middleware";

const router = Router();
router.use(requireAuth);

/** Разрешённые значения purchase_mode */
const VALID_MODES = ["exchange_to_market", "direct", "import", "on_demand", "do_not_purchase"];
/** Разрешённые значения purchase_status */
const VALID_STATUSES = ["active", "on_request", "blocked"];

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT code, name, min_stock_kg, purchase_coefficient,
             purchase_threshold_months, purchase_batch_kg,
             lead_time_days, purchase_mode, purchase_status, purchase_comment
      FROM sku WHERE active = true ORDER BY code
    `);
    res.json(rows.rows);
  } catch (err: any) {
    console.error("[sku-params/get]", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:code", async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    const body = req.body ?? {};

    // Verify SKU exists
    const check = await db.execute(sql`SELECT code FROM sku WHERE code = ${code} AND active = true`);
    if (check.rows.length === 0) return res.status(404).json({ error: "SKU not found" });

    const sets: any[] = [];

    // min_stock_kg
    if (body.min_stock_kg !== undefined) {
      const v = body.min_stock_kg === null ? null : Number(body.min_stock_kg);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "min_stock_kg must be >= 0" });
      sets.push(sql`min_stock_kg = ${v}`);
    }

    // purchase_coefficient: 0.0 – 1.5
    if (body.purchase_coefficient !== undefined) {
      const n = Number(body.purchase_coefficient);
      if (!Number.isFinite(n) || n < 0 || n > 1.5) return res.status(400).json({ error: "purchase_coefficient must be 0.0–1.5" });
      sets.push(sql`purchase_coefficient = ${n}`);
    }

    // purchase_threshold_months: >= 0
    if (body.purchase_threshold_months !== undefined) {
      const v = body.purchase_threshold_months === null ? null : Number(body.purchase_threshold_months);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "purchase_threshold_months must be >= 0" });
      sets.push(sql`purchase_threshold_months = ${v}`);
    }

    // purchase_batch_kg: >= 0
    if (body.purchase_batch_kg !== undefined) {
      const v = body.purchase_batch_kg === null ? null : Number(body.purchase_batch_kg);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "purchase_batch_kg must be >= 0" });
      sets.push(sql`purchase_batch_kg = ${v}`);
    }

    // lead_time_days: >= 0
    if (body.lead_time_days !== undefined) {
      const v = body.lead_time_days === null ? null : Math.round(Number(body.lead_time_days));
      if (v !== null && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "lead_time_days must be >= 0" });
      sets.push(sql`lead_time_days = ${v}`);
    }

    // purchase_mode: enum
    if (body.purchase_mode !== undefined) {
      const v = body.purchase_mode === null ? null : body.purchase_mode;
      if (v !== null && !VALID_MODES.includes(v)) return res.status(400).json({ error: "purchase_mode must be one of: " + VALID_MODES.join(", ") });
      sets.push(sql`purchase_mode = ${v}`);
    }

    // purchase_status: enum
    if (body.purchase_status !== undefined) {
      const v = body.purchase_status === null ? null : body.purchase_status;
      if (v !== null && !VALID_STATUSES.includes(v)) return res.status(400).json({ error: "purchase_status must be one of: " + VALID_STATUSES.join(", ") });
      sets.push(sql`purchase_status = ${v}`);
    }

    // purchase_comment: text
    if (body.purchase_comment !== undefined) {
      const v = body.purchase_comment === null ? null : String(body.purchase_comment);
      sets.push(sql`purchase_comment = ${v}`);
    }

    if (sets.length === 0) return res.status(400).json({ error: "no fields to update" });

    await db.execute(sql`UPDATE sku SET ${sql.join(sets, sql`, `)} WHERE code = ${code}`);

    // Return updated row
    const updated = await db.execute(sql`
      SELECT code, name, min_stock_kg, purchase_coefficient,
             purchase_threshold_months, purchase_batch_kg,
             lead_time_days, purchase_mode, purchase_status, purchase_comment
      FROM sku WHERE code = ${code}
    `);
    res.json(updated.rows[0]);
  } catch (err: any) {
    console.error("[sku-params/put]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
