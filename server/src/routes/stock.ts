/**
 * Остатки сырья. Эндпоинты:
 *   GET  /api/stock/live              — живые остатки (Полоцк + Липковская −
 *                                       потребление рецептов «в работе»/«удалён»)
 *   GET  /api/stock/snapshots         — загруженные снимки остатков (по дате)
 *                                       для группового удаления
 *   POST /api/stock/snapshots/delete  — удалить снимки { items: [{sheet, date}] }
 *
 * Источник — Google Sheets (PlantStock / LipStock). Inbound (товары в пути) в
 * живые остатки не входит. Доступ только для авторизованных.
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  getLiveStock, getStockSnapshots, deleteStockSnapshot, getStockDeficit,
} from "../services/sheetsService";

const router = Router();

router.use(requireAuth);

router.get("/live", async (_req: Request, res: Response) => {
  try {
    res.json(await getLiveStock());
  } catch (err: any) {
    console.error("[stock/live]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Дефицит/закупка: по каждому сырью остаток, списание, сигнал и разбивка по рецептам. */
router.get("/deficit", async (_req: Request, res: Response) => {
  try {
    res.json(await getStockDeficit());
  } catch (err: any) {
    console.error("[stock/deficit]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/snapshots", async (_req: Request, res: Response) => {
  try {
    res.json(await getStockSnapshots());
  } catch (err: any) {
    console.error("[stock/snapshots]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/snapshots/delete", async (req: Request, res: Response) => {
  const items: { sheet: string; date: string }[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Не выбраны снимки" });
  const allowed = new Set(["PlantStock", "LipStock"]);
  for (const it of items) {
    if (!allowed.has(String(it?.sheet))) {
      return res.status(400).json({ error: `Недопустимый лист: ${it?.sheet}` });
    }
  }
  try {
    let removed = 0;
    for (const it of items) {
      removed += await deleteStockSnapshot(it.sheet, it.date);
    }
    res.json({ ok: true, removed });
  } catch (err: any) {
    console.error("[stock/snapshots/delete]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
