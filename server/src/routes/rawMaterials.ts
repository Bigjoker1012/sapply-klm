import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
getAllRawMaterials,
} from "../services/readSwitch";
import { deleteRawMaterial, mergeRawMaterials, addRawMaterial, updateRawMaterial } from "../services/readSwitch";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  try {
    const materials = await getAllRawMaterials();
    res.json(materials.map(m => ({
      id: m.raw_uid,
      uid: m.raw_uid,
      name: m.full_name,
      short_name: m.short_name,
      unit: m.unit,
      avg_monthly_consumption: m.avg_monthly_usage,
      reorder_threshold_factor: m.reorder_threshold_factor,
      lead_time_days: m.lead_time_days,
      active: m.active,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { uid, name, short_name, unit, avg_monthly_consumption, reorder_threshold_factor, lead_time_days } = req.body;
  try {
    await addRawMaterial({ code: uid, name, short_name, unit, category: "other", active: true });
    res.json({ raw_uid: uid, full_name: name, message: "Сырьё добавлено" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Слияние двух позиций каталога: sourceUid сливается в targetUid. Все остатки,
 * потребности и синонимы source перепривязываются на target, прежнее название
 * source становится синонимом, source удаляется. full_name/short_name —
 * опциональное переименование target (например, общее короткое название).
 */
router.post("/merge", async (req: Request, res: Response) => {
  const { sourceUid, targetUid, full_name, short_name } = req.body;
  try {
    const rename = (full_name || short_name) ? { full_name, short_name } : undefined;
    const counts = await mergeRawMaterials(sourceUid, targetUid, rename);
    res.json({ ok: true, ...counts });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:uid", async (req: Request, res: Response) => {
  const { avg_monthly_consumption, reorder_threshold_factor } = req.body;
  try {
    await updateRawMaterial(req.params.uid, { name: req.body.name, short_name: req.body.short_name, unit: req.body.unit, active: req.body.active });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:uid", async (req: Request, res: Response) => {
  try {
    const ok = await deleteRawMaterial(req.params.uid);
    if (!ok) return res.status(404).json({ error: "Позиция не найдена" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
