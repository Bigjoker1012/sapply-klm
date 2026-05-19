import { Router, Request, Response } from "express";
import multer from "multer";
import {
  matchBatch, addAliasesBatch, addToReviewQueueBatch,
  writePlantStock, writeLipStockBatch, writeLipBatchesBulk,
  writeRecipe, writeRecipeLines, writeNeedFromRecipe,
  getUnresolvedQueue, resolveQueueItem, addAlias,
} from "../services/sheetsService";
import { parsePolotskPdf, parseRecipePdf } from "../services/pdfParser";
import { parsePolotskExcel, parseRecipeExcel, parseKdExcel } from "../services/excelParser";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ─── Загрузка Excel / PDF остатков Полоцка ────────────────────────────────────

router.post("/polotsk", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const isPdf = req.file.mimetype === "application/pdf" || req.file.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parsePolotskPdf(req.file.buffer)
      : parsePolotskExcel(req.file.buffer);

    // 1. Match ALL names in one batch (2 API calls: Syryo + Aliases)
    const matchMap = await matchBatch(parsed.map(r => r.rawName));

    const stockRows: { raw_uid: string; name_from_source: string; qty: number; source_file: string }[] = [];
    const newAliases: { raw_uid: string; alias: string; source: string }[] = [];
    const queueItems: { text: string; source_type: string; file_name: string }[] = [];
    let matched = 0;
    let unmatched = 0;

    for (const row of parsed) {
      const rawUid = matchMap.get(row.rawName);
      if (rawUid) {
        stockRows.push({ raw_uid: rawUid, name_from_source: row.rawName, qty: row.quantity, source_file: req.file!.originalname });
        newAliases.push({ raw_uid: rawUid, alias: row.rawName, source: "polotsk_file" });
        matched++;
      } else {
        queueItems.push({ text: row.rawName, source_type: "polotsk", file_name: req.file!.originalname });
        unmatched++;
      }
    }

    // 2. Write stock + aliases + queue in parallel (each is 1-2 calls)
    await Promise.all([
      stockRows.length ? writePlantStock(stockRows) : Promise.resolve(),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    res.json({ ok: true, total: parsed.length, matched, unmatched, message: `Загружено: ${matched}, не распознано: ${unmatched}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Загрузка Excel остатков Липковской ───────────────────────────────────────

router.post("/lipkovskaya", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const parsed = parsePolotskExcel(req.file.buffer);

    // 1. Match ALL names in one batch
    const matchMap = await matchBatch(parsed.map(r => r.rawName));

    const stockRows: { raw_uid: string; name_from_source: string; qty: number; source: string }[] = [];
    const newAliases: { raw_uid: string; alias: string; source: string }[] = [];
    const queueItems: { text: string; source_type: string; file_name: string }[] = [];
    let matched = 0;
    let unmatched = 0;

    for (const row of parsed) {
      const rawUid = matchMap.get(row.rawName);
      if (rawUid) {
        stockRows.push({ raw_uid: rawUid, name_from_source: row.rawName, qty: row.quantity, source: "excel_file" });
        newAliases.push({ raw_uid: rawUid, alias: row.rawName, source: "lipkovskaya_file" });
        matched++;
      } else {
        queueItems.push({ text: row.rawName, source_type: "lipkovskaya", file_name: req.file!.originalname });
        unmatched++;
      }
    }

    // 2. Write all in parallel (3 API calls total vs N×4 before)
    await Promise.all([
      writeLipStockBatch(stockRows),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    res.json({
      ok: true,
      total: parsed.length,
      matched,
      unmatched,
      message: `Загружено: ${matched}, не распознано: ${unmatched}`,
    });
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

    // 1. Match ALL recipe row names at once
    const matchMap = await matchBatch(parsed.rows.map(r => r.rawName));

    // 2. Write recipe header
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
    const newAliases: { raw_uid: string; alias: string; source: string }[] = [];
    const queueItems: { text: string; source_type: string; file_name: string }[] = [];

    for (const row of parsed.rows) {
      const rawUid = matchMap.get(row.rawName) ?? null;
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
        newAliases.push({ raw_uid: rawUid, alias: row.rawName, source: "recipe" });
        if (consumption_kg > 0) needLines.push({ raw_uid: rawUid, net_qty: consumption_kg });
        matched++;
      } else {
        queueItems.push({ text: row.rawName, source_type: "recipe", file_name: req.file!.originalname });
        unmatched++;
      }
    }

    // 3. Write lines, aliases, queue in parallel
    await Promise.all([
      writeRecipeLines(recipeUid, lines),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    if (needLines.length) await writeNeedFromRecipe(recipeUid, needLines);

    res.json({ ok: true, recipeUid, recipeName: parsed.name, total: parsed.rows.length, matched, unmatched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Загрузка КД "Ведомость по партиям" Липковской ───────────────────────────
// Каждая строка КД = отдельная партия. Сохраняем в LipBatches (гранулярно)
// и в LipStock (агрегат по raw_uid для расчётов дашборда).

router.post("/lipkovskaya-kd", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const parsed = parseKdExcel(req.file.buffer);
    if (!parsed.length) return res.status(400).json({ error: "Нет данных в файле (проверьте формат КД)" });

    // 1. Match ALL base names at once (2 API calls)
    const matchMap = await matchBatch(parsed.map(r => r.baseName));

    const batchRows: { raw_uid: string; batch_code: string; vendor_name: string; qty: number; source: string }[] = [];
    const stockAggregate = new Map<string, { name: string; qty: number }>();
    const newAliases: { raw_uid: string; alias: string; source: string }[] = [];
    const queueItems: { text: string; source_type: string; file_name: string }[] = [];
    let matched = 0;
    let unmatched = 0;

    for (const row of parsed) {
      const rawUid = matchMap.get(row.baseName);
      if (rawUid) {
        batchRows.push({ raw_uid: rawUid, batch_code: row.batchCode, vendor_name: row.vendorName, qty: row.qty, source: "kd_file" });
        // Aggregate for LipStock
        const cur = stockAggregate.get(rawUid);
        stockAggregate.set(rawUid, { name: row.baseName, qty: (cur?.qty ?? 0) + row.qty });
        // Register baseName as alias if it came with a batch suffix
        if (row.batchCode) {
          newAliases.push({ raw_uid: rawUid, alias: row.baseName, source: "kd_file" });
        }
        matched++;
      } else {
        queueItems.push({ text: row.baseName, source_type: "lipkovskaya_kd", file_name: req.file!.originalname });
        unmatched++;
      }
    }

    // 2. Build LipStock aggregate rows
    const lipStockRows = Array.from(stockAggregate.entries()).map(([raw_uid, v]) => ({
      raw_uid, name_from_source: v.name, qty: v.qty, source: "kd_file",
    }));

    // 3. Write everything in parallel (LipBatches + LipStock aggregate + aliases + queue)
    await Promise.all([
      writeLipBatchesBulk(batchRows),
      writeLipStockBatch(lipStockRows),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    res.json({
      ok: true,
      total: parsed.length,
      matched,
      unmatched,
      batches: batchRows.length,
      message: `КД загружен: ${matched} позиций (${batchRows.length} партий), не распознано: ${unmatched}`,
    });
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
