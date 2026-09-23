import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  addInbound, getInboundList, updateInboundStatus, deleteInbound,
  deleteInboundByMaterial,
} from "../services/sheetsService";

const router = Router();

// Все операции с «в пути» — только для авторизованных (как planning/recipes/
// stock/dashboard). Эндпоинты меняют остатки, публичными быть не должны.
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  try {
    const list = await getInboundList();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { raw_uid, raw_name, rawMaterialId, quantity, eta, direction, document, comment } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    const name = raw_name || rawMaterialId || "";
    const id = await addInbound(uid, name, parseFloat(quantity), eta, direction || "", document || comment || "");
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/status", async (req: Request, res: Response) => {
  const { status } = req.body;
  try {
    await updateInboundStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Отмена «в пути» по сырью — выключатель переключателя на «Планировании»
// (помечает удалёнными все активные приходы этого материала). Объявлен ДО
// "/:id", иначе ":id" перехватил бы путь "by-material".
router.delete("/by-material/:raw_uid", async (req: Request, res: Response) => {
  try {
    const changed = await deleteInboundByMaterial(req.params.raw_uid);
    res.json({ ok: true, changed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteInbound(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
