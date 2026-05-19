import { Router, Request, Response } from "express";
import {
  getLatestPlantStock, getLipStockList, writeLipStock, getAllRawMaterials,
} from "../services/sheetsService";

const router = Router();

router.get("/polotsk", async (_req: Request, res: Response) => {
  try {
    const [stock, materials] = await Promise.all([getLatestPlantStock(), getAllRawMaterials()]);
    const nameMap = new Map(materials.map(m => [m.raw_uid, m.full_name]));
    const list = Array.from(stock.entries()).map(([uid, qty]) => ({
      raw_uid: uid,
      name: nameMap.get(uid) || uid,
      quantity: qty,
    }));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/lipkovskaya", async (_req: Request, res: Response) => {
  try {
    const list = await getLipStockList();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lipkovskaya", async (req: Request, res: Response) => {
  const { raw_uid, rawMaterialId, name_from_source, totalQuantity, qty_on_hand, reserve, reserved_qty, freeQuantity, free_qty, date } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    const total = parseFloat(totalQuantity || qty_on_hand || 0);
    const res_qty = parseFloat(reserve || reserved_qty || 0);
    const free = parseFloat(freeQuantity || free_qty || -1);
    await writeLipStock(uid, name_from_source || uid, total, res_qty, free, "manual");
    res.json({ ok: true, message: "Остаток Липковской обновлён" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
