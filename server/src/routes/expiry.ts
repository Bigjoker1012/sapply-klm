import { Router, Request, Response } from "express";
import { getLipBatchesList, getAllRawMaterials } from "../services/sheetsService";

const router = Router();

/**
 * Calculate expiry status based on days remaining:
 * - "expired": <= 0 days
 * - "urgent": 1-30 days (red)
 * - "warning": 31-90 days (yellow)
 * - "ok": >90 days (green)
 */
function getExpiryStatus(expiryDate: string): { status: string; daysRemaining: number; color: string } {
  if (!expiryDate) return { status: "unknown", daysRemaining: -1, color: "gray" };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  
  const diffTime = expiry.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (daysRemaining < 0) return { status: "expired", daysRemaining, color: "red" };
  if (daysRemaining <= 30) return { status: "urgent", daysRemaining, color: "red" };
  if (daysRemaining <= 90) return { status: "warning", daysRemaining, color: "yellow" };
  return { status: "ok", daysRemaining, color: "green" };
}

/**
 * GET /api/expiry
 * Returns all batches with expiry information, grouped by product.
 * Each batch includes traffic light status.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [batches, materials] = await Promise.all([
      getLipBatchesList(),
      getAllRawMaterials(),
    ]);

    // Create name map for lookup
    const nameMap = new Map(materials.map((m: any) => [m.uid, m.full_name]));

    // Get only latest batches per raw_uid
    const latestByUid = new Map<string, any>();
    for (const batch of batches) {
      if (!batch.raw_uid) continue;
      const existing = latestByUid.get(batch.raw_uid);
      if (!existing || batch.snapshot_date > existing.snapshot_date) {
        latestByUid.set(batch.raw_uid, batch);
      }
    }

    // Build response with expiry status
    const result = Array.from(latestByUid.entries()).map(([raw_uid, batch]) => {
      const expiryInfo = getExpiryStatus(batch.expiry_date);
      return {
        raw_uid,
        name: nameMap.get(raw_uid) || raw_uid,
        batch_code: batch.batch_code,
        vendor_name: batch.vendor_name,
        qty: batch.qty,
        unit: batch.unit,
        expiry_date: batch.expiry_date,
        manufacture_date: batch.manufacture_date,
        days_remaining: expiryInfo.daysRemaining,
        status: expiryInfo.status,
        color: expiryInfo.color,
      };
    });

    // Sort by days remaining (most urgent first)
    result.sort((a, b) => {
      if (a.days_remaining < 0 && b.days_remaining >= 0) return -1;
      if (a.days_remaining >= 0 && b.days_remaining < 0) return 1;
      return a.days_remaining - b.days_remaining;
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
