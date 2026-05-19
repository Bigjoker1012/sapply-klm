import { Router, Request, Response } from "express";
import {
  readRange, appendRows, getAllRawMaterials,
  getUnresolvedQueue, resolveQueueItem, addAlias,
} from "../services/sheetsService";
import { suggestMatches } from "../services/aiMatcher";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [aliasRows, materials] = await Promise.all([
      readRange("Aliases", "A2:D5000"),
      getAllRawMaterials(),
    ]);
    const nameMap = new Map(materials.map(m => [m.raw_uid, m.full_name]));
    const result = aliasRows
      .filter(r => r[0] && r[1] && r[2])
      .map(r => ({
        id: r[0],
        raw_uid: r[1],
        name: nameMap.get(r[1]) || r[1],
        synonym: r[2],
        source: r[3] || "",
      }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const { rawMaterialId, raw_uid, synonym, source } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    await addAlias(uid, synonym, source || "manual");
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const rows = await readRange("Aliases", "A2:D5000");
    const idx = rows.findIndex(r => r[0] === req.params.id);
    if (idx >= 0) {
      // Mark as deleted by clearing the row
      const { writeRange } = await import("../services/sheetsService");
      await writeRange("Aliases", `A${idx + 2}:D${idx + 2}`, [["", "", "", ""]]);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/unmatched", async (_req: Request, res: Response) => {
  try {
    const items = await getUnresolvedQueue();
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/confirm", async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, raw_uid, synonym } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    if (synonym) await addAlias(uid, synonym, "manual");
    if (queueId) await resolveQueueItem(queueId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ИИ-сопоставление ─────────────────────────────────────────────────────

router.post("/ai-suggest", async (req: Request, res: Response) => {
  const { items } = req.body; // string[]
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "items[] обязателен" });
  }
  try {
    const materials = await getAllRawMaterials();
    const suggestions = await suggestMatches(items, materials);
    res.json(suggestions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
