import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { getAllRawMaterials } from "../services/readSwitch";
import {
  getAliases, addAlias as addAliasPG, deleteAlias, matchAlias,
  getUnresolved, resolveUnresolved, resolveUnresolvedByText, addUnresolved, addUnresolvedBatch,
  getExcluded, addExcludedBatch as addExcludedBatchPG,
  writePlantStock, writeLipStockBatch,
} from "../services/readSwitch";

import { suggestMatches } from "../services/aiMatcher";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  try {
    const [aliasRows, materials] = await Promise.all([
      getAliases(),
      getAllRawMaterials(),
    ]);
    const nameMap = new Map(materials.map(m => [m.raw_uid, m.full_name]));
    const result = aliasRows.map(a => ({
      id: a.id,
      canonical_raw_uid: a.raw_uid,
      name: a.raw_uid
        ? (nameMap.get(a.raw_uid) || a.raw_uid)
        : "(не привязано)",
      resolved: !!a.raw_uid,
      synonym: a.alias,
      source: a.source,
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
    await addAliasPG(uid, synonym, source || "manual");
    // Если синоним совпадает с текстом в очереди — записываем остаток
    if (uid && synonym) {
      const queue = await getUnresolved();
      const match = queue.find(q => q.text === synonym);
      if (match && match.qty > 0) {
        const sourceType = match.source_warehouse || "polotsk";
        const stockRow = { raw_uid: uid, name_from_source: synonym, qty: match.qty, source_file: "synonym_confirm" };
        if (sourceType === "polotsk") {
          await writePlantStock([stockRow]);
        } else {
          await writeLipStockBatch([{ ...stockRow, source: "synonym_confirm" }]);
        }
        // Помечаем очередь как обработанную
        if (match.id) await resolveUnresolved(match.id);
      }
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { db } = await import("../db/client");
    const { sql } = await import("drizzle-orm");
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await db.execute(sql`DELETE FROM sku_alias WHERE id = ${id}`);
    res.json({ ok: true, deleted: (result as any).rowCount || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/unmatched", async (_req: Request, res: Response) => {
  try {
    const items = await getUnresolved();
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/confirm", async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, raw_uid, synonym } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    if (synonym) await addAliasPG(uid, synonym, "manual");
    if (queueId) {
      const queueItem = await (await import("../services/readSwitch")).getUnresolved().then(items => items.find((i: any) => i.id === queueId));
      if (queueItem) await (await import("../services/readSwitch")).resolveUnresolved(queueId);
      // Если в очереди было количество и склад — записываем остаток
      if (queueItem && queueItem.qty > 0 && uid) {
        const sourceType = queueItem.source_warehouse || "polotsk";
        const stockRow = { raw_uid: uid, name_from_source: queueItem.text, qty: queueItem.qty, source_file: "queue_confirm" };
        if (sourceType === "polotsk") {
          await writePlantStock([stockRow]);
        } else {
          await writeLipStockBatch([{ ...stockRow, source: "queue_confirm" }]);
        }
      }
    }
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
