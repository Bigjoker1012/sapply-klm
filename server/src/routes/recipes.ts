import { Router, Request, Response } from "express";
import { getRecipesList, readRange } from "../services/sheetsService";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const list = await getRecipesList();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:uid/lines", async (req: Request, res: Response) => {
  try {
    const rows = await readRange("RecipeLines", "A2:L5000");
    const lines = rows
      .filter(r => r[1] === req.params.uid)
      .map(r => ({
        id: r[0], recipe_uid: r[1], raw_uid: r[2],
        name_from_recipe: r[3], activity: r[4],
        input_pct: parseFloat(r[5]) || 0,
        norm_g_per_t: parseFloat(r[6]) || 0,
        consumption_kg: parseFloat(r[7]) || 0,
        match_status: r[11],
      }));
    res.json(lines);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
