import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { getSkuParams, updateSkuParams } from "../services/readSwitch";

const router = Router();
router.use(requireAuth);

// GET /api/sku-params — Get all SKU parameters
router.get("/", async (_req: Request, res: Response) => {
  try {
    const params = await getSkuParams();
    res.json(params);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sku-params/:code — Update SKU parameters
router.put("/:code", async (req: Request, res: Response) => {
  const { min_stock_kg, purchase_coefficient } = req.body;
  try {
    await updateSkuParams(req.params.code, { min_stock_kg, purchase_coefficient });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
