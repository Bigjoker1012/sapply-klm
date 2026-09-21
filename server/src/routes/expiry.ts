/**
 * Сроки годности — партии Липковской.
 *   GET  /api/expiry           — все партии lip_batch с датами
 *   PUT  /api/expiry/:id       — сохранить даты производства/годности
 */
import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT lb.id, lb.batch_code, lb.qty_kg, lb.unit, lb.source,
             lb.expiry_date, lb.manufacture_date, lb.snapshot_date,
             lb.vendor_name,
             s.code as sku_code, s.name as sku_name
      FROM lip_batch lb
      JOIN sku s ON lb.sku_id = s.id
      WHERE lb.qty_kg > 0
      ORDER BY lb.snapshot_date DESC, s.name, lb.batch_code
    `);
    res.json(rows.rows);
  } catch (err: any) {
    console.error("[expiry/get]", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const { manufacture_date, expiry_date } = req.body ?? {};

    const sets: any[] = [];
    if (manufacture_date !== undefined) {
      const v = manufacture_date === null || manufacture_date === "" ? null : String(manufacture_date);
      sets.push(sql`manufacture_date = ${v}`);
    }
    if (expiry_date !== undefined) {
      const v = expiry_date === null || expiry_date === "" ? null : String(expiry_date);
      sets.push(sql`expiry_date = ${v}`);
    }

    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    await db.execute(sql`UPDATE lip_batch SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);

    const updated = await db.execute(sql`
      SELECT lb.id, lb.batch_code, lb.qty_kg, lb.unit, lb.source,
             lb.expiry_date, lb.manufacture_date, lb.snapshot_date,
             lb.vendor_name,
             s.code as sku_code, s.name as sku_name
      FROM lip_batch lb
      JOIN sku s ON lb.sku_id = s.id
      WHERE lb.id = ${id}
    `);
    res.json(updated.rows[0] ?? { id });
  } catch (err: any) {
    console.error("[expiry/put]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
