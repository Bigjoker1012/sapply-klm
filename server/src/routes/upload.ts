import { Router, Request, Response } from "express";
import multer from "multer";
import {
  findRawByAlias, addToReviewQueue, addAlias,
  writePlantStock, writeRecipe, writeRecipeLines, writeNeedFromRecipe,
  getUnresolvedQueue, resolveQueueItem,
} from "../services/sheetsService";
import { parsePolotskPdf, parseRecipePdf } from "../services/pdfParser";
import { parsePolotskExcel, parseRecipeExcel } from "../services/excelParser";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ─── Загрузка квартального Excel / PDF остатков Полоцка ───────────────────

router.post("/polotsk", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parsePolotskPdf(req.file.buffer)
      : parsePolotskExcel(req.file.buffer);

    let matched = 0;
    let unmatched = 0;
    const stockRows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[] = [];

    for (const row of parsed) {
      const rawUid = await findRawByAlias(row.rawName);
      if (rawUid) {
        stockRows.push({ raw_uid: rawUid, name_from_source: row.rawName, qty: row.quantity, source_file: req.file!.originalname });
        await addAlias(rawUid, row.rawName, "polotsk_file");
        matched++;
      } else {
        await addToReviewQueue(row.rawName, "polotsk", req.file!.originalname);
        unmatched++;
      }
    }

    if (stockRows.length) await writePlantStock(stockRows);

    res.json({ ok: true, total: parsed.length, matched, unmatched, message: `Загружено: ${matched}, не распознано: ${unmatched}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Загрузка рецепта (PDF или Excel) ─────────────────────────────────────

router.post("/recipe", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parseRecipePdf(req.file.buffer)
      : parseRecipeExcel(req.file.buffer);

    const base_batch_kg = parseFloat(req.body?.batchQty) || 1000;

    const recipeUid = await writeRecipe({
      code: parsed.code,
      full_name: parsed.name,
      premix_name: parsed.name,
      date: parsed.date,
      concentration: 0,
      batch_t: base_batch_kg / 1000,
      customer: "",
      period: new Date().toISOString().slice(0, 7),
      quarter: `${Math.ceil((new Date().getMonth() + 1) / 3)}_квартал`,
      file_name: req.file.originalname,
      base_batch_kg,
    });

    let matched = 0;
    let unmatched = 0;
    const lines: Parameters<typeof writeRecipeLines>[1] = [];
    const needLines: { raw_uid: string; net_qty: number }[] = [];

    for (const row of parsed.rows) {
      const rawUid = await findRawByAlias(row.rawName);
      const consumption_kg = row.quantityPerTon > 0
        ? (row.quantityPerTon / 1000) * base_batch_kg
        : row.percentage > 0
        ? (row.percentage / 100) * base_batch_kg
        : 0;

      lines.push({
        raw_uid: rawUid,
        name_from_recipe: row.rawName,
        activity: "",
        input_pct: row.percentage,
        norm_g_per_t: row.quantityPerTon,
        consumption_kg,
        match_status: rawUid ? "matched" : "unmatched",
      });

      if (rawUid) {
        await addAlias(rawUid, row.rawName, "recipe");
        if (consumption_kg > 0) needLines.push({ raw_uid: rawUid, net_qty: consumption_kg });
        matched++;
      } else {
        await addToReviewQueue(row.rawName, "recipe", req.file!.originalname);
        unmatched++;
      }
    }

    await writeRecipeLines(recipeUid, lines);
    if (needLines.length) await writeNeedFromRecipe(recipeUid, needLines);

    res.json({ ok: true, recipeUid, recipeName: parsed.name, total: parsed.rows.length, matched, unmatched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Нераспознанные строки ──────────────────────────────────────────────────

router.get("/unmatched", async (_req: Request, res: Response) => {
  try {
    res.json(await getUnresolvedQueue());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/unmatched/confirm", async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, raw_uid, synonym } = req.body;
  try {
    const uid = raw_uid || rawMaterialId;
    if (uid && synonym) await addAlias(uid, synonym, "manual");
    if (queueId) await resolveQueueItem(queueId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
