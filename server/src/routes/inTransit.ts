import { Router, Request, Response } from "express";
import {
  addInbound, getInboundList, updateInboundStatus, deleteInbound,
} from "../services/sheetsService";

const router = Router();

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

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await deleteInbound(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
