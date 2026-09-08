import { Router, Request, Response } from "express";
import { getLipBatchesList, getAllRawMaterials, updateLipBatchExpiry } from "../services/sheetsService";

const router = Router();

function getExpiryStatus(expiryDate: string): { status: string; daysRemaining: number; color: string } {
  if (!expiryDate) return { status: "unknown", daysRemaining: -1, color: "gray" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate); expiry.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (daysRemaining < 0) return { status: "expired", daysRemaining, color: "red" };
  if (daysRemaining <= 30) return { status: "urgent", daysRemaining, color: "red" };
  if (daysRemaining <= 90) return { status: "warning", daysRemaining, color: "yellow" };
  return { status: "ok", daysRemaining, color: "green" };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [batches, materials] = await Promise.all([getLipBatchesList(), getAllRawMaterials()]);
    const nameMap = new Map(materials.map((m: any) => [m.uid, m.full_name]));
    const latestByUid = new Map<string, any>();
    for (const batch of batches) {
      if (!batch.raw_uid) continue;
      const existing = latestByUid.get(batch.raw_uid);
      if (!existing || batch.snapshot_date > existing.snapshot_date) {
        latestByUid.set(batch.raw_uid, batch);
      }
    }
    const result = Array.from(latestByUid.entries()).map(([raw_uid, batch]) => {
      const expiryInfo = getExpiryStatus(batch.expiry_date);
      return {
        raw_uid, name: nameMap.get(raw_uid) || raw_uid,
        batch_code: batch.batch_code, vendor_name: batch.vendor_name,
        qty: batch.qty, unit: batch.unit,
        expiry_date: batch.expiry_date, manufacture_date: batch.manufacture_date,
        days_remaining: expiryInfo.daysRemaining, status: expiryInfo.status, color: expiryInfo.color,
      };
    });
    result.sort((a, b) => a.days_remaining - b.days_remaining);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/:raw_uid", async (req: Request, res: Response) => {
  try {
    const { raw_uid } = req.params;
    const { expiry_date, manufacture_date } = req.body;
    if (!expiry_date && expiry_date !== "") {
      return res.status(400).json({ error: "expiry_date is required" });
    }
    if (expiry_date && expiry_date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      return res.status(400).json({ error: "expiry_date must be YYYY-MM-DD format" });
    }
    const updated = await updateLipBatchExpiry(raw_uid, expiry_date || null, manufacture_date || null);
    res.json({ ok: true, updated, message: "Обновлён срок годности для " + raw_uid });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;