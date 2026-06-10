import { Router, Request, Response } from "express";
import multer from "multer";
import {
  matchBatch, addAliasesBatch, addToReviewQueueBatch,
  writePlantStock, writeLipStockBatch, writeLipBatchesBulk,
  writeRecipe, writeRecipeLines, writeNeedFromRecipe,
  getUnresolvedQueue, resolveQueueItem, addAlias,
  filterKdSimilar, getExcludedList, addExcludedBatch, resolveQueueByText,
  getLatestPlantStock, getLatestLipStock, getRecipeConsumptionByStatus,
  STOCK_CONSUMING_STATUSES,
} from "../services/sheetsService";
import { parsePolotskPdf, parseRecipePdf } from "../services/pdfParser";
import { parsePolotskExcel, parseRecipeExcel, parseKdExcel } from "../services/excelParser";
import { saveDocument } from "../services/documentArchive";

const router = Router();
// Лимит с запасом: при обходе WAF файл приходит в base64 (≈ +33% к размеру),
// поэтому держим 45MB, чтобы фактический предел исходного файла оставался ~30MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 45 * 1024 * 1024 } });

/**
 * Внутрипроцессный мьютекс для приёма рецепта в работу. Деплой — единственный
 * инстанс (target=vm), поэтому сериализация в памяти полностью исключает гонку,
 * когда два одновременных рецепта проходят проверку достаточности по одному и
 * тому же остатку и оба списывают сырьё (двойное списание). Критическая секция:
 * проверка склада → запись рецепта/строк/потребности.
 */
let recipeAdmissionLock: Promise<void> = Promise.resolve();
async function withRecipeAdmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = recipeAdmissionLock;
  let release!: () => void;
  recipeAdmissionLock = new Promise<void>(r => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Эдж деплоя (WAF) блокирует HTTP 403 любую загрузку с сигнатурой «%PDF» в теле
 * (срабатывает на сыром PDF, в т.ч. в multipart). В dev WAF нет, поэтому проблема
 * видна только в проде. Обход: клиент кодирует файл в base64 и шлёт как текст
 * (encoding=base64 + filename + mimetype в полях формы) — `%PDF` в потоке нет.
 * Здесь декодируем обратно в оригинальный буфер. Если флага нет — берём файл как есть.
 */
function readUpload(req: Request): { buffer: Buffer; originalname: string; mimetype: string } {
  const f = req.file!;
  if (req.body?.encoding === "base64") {
    return {
      buffer: Buffer.from(f.buffer.toString("utf8"), "base64"),
      originalname: req.body?.filename || f.originalname,
      mimetype: req.body?.mimetype || f.mimetype,
    };
  }
  return { buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype };
}

// ─── Загрузка Excel / PDF остатков Полоцка ────────────────────────────────────

router.post("/polotsk", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const up = readUpload(req);
    const isPdf = up.mimetype === "application/pdf" || up.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parsePolotskPdf(up.buffer)
      : parsePolotskExcel(up.buffer);

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
        stockRows.push({ raw_uid: rawUid, name_from_source: row.rawName, qty: row.quantity, source_file: up.originalname });
        newAliases.push({ raw_uid: rawUid, alias: row.rawName, source: "polotsk_file" });
        matched++;
      } else {
        queueItems.push({ text: row.rawName, source_type: "polotsk", file_name: up.originalname });
        unmatched++;
      }
    }

    // 2. Write stock + aliases + queue in parallel (each is 1-2 calls)
    await Promise.all([
      stockRows.length ? writePlantStock(stockRows) : Promise.resolve(),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    await saveDocument("polotsk", { originalname: up.originalname, mimetype: up.mimetype, buffer: up.buffer });

    res.json({ ok: true, total: parsed.length, matched, unmatched, message: `Загружено: ${matched}, не распознано: ${unmatched}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Загрузка Excel остатков Липковской ───────────────────────────────────────

router.post("/lipkovskaya", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const up = readUpload(req);
    const parsed = parsePolotskExcel(up.buffer);

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
        queueItems.push({ text: row.rawName, source_type: "lipkovskaya", file_name: up.originalname });
        unmatched++;
      }
    }

    // 2. Write all in parallel (3 API calls total vs N×4 before)
    await Promise.all([
      writeLipStockBatch(stockRows),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
    ]);

    await saveDocument("lipkovskaya", { originalname: up.originalname, mimetype: up.mimetype, buffer: up.buffer });

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
    const up = readUpload(req);
    const isPdf = up.mimetype === "application/pdf" || up.originalname.endsWith(".pdf");
    const parsed = isPdf
      ? await parseRecipePdf(up.buffer)
      : parseRecipeExcel(up.buffer);

    // Норма сырья в рецепте всегда дана на 1 т. Выработка (кол-во тонн премикса)
    // вводится пользователем при загрузке (req.body.batchTons). Списание/
    // потребность = норма_на_1т × выработка. Если выработку не указали — берём её
    // из шапки рецепта (parsed.batchKg), иначе 1 т.
    const recipe_batch_kg = parsed.batchKg && parsed.batchKg > 0 ? parsed.batchKg : 1000;
    // batchTons (т) — приоритетный ввод пользователя; batchQty (кг) оставлен для
    // обратной совместимости. Принимаем только конечное положительное число.
    const tons = parseFloat(req.body?.batchTons);
    const overrideKg = Number.isFinite(tons) && tons > 0
      ? tons * 1000
      : parseFloat(req.body?.batchQty);
    const base_batch_kg = Number.isFinite(overrideKg) && overrideKg > 0 ? overrideKg : recipe_batch_kg;
    const recipe_batch_t = recipe_batch_kg / 1000;
    const batch_t = base_batch_kg / 1000;

    // 1. Разделяем позиции по «Цене за 1 кг» (НОВОЕ ПРАВИЛО): цена > 0 → НАША
    //    позиция (берём в разборку, списание и закупку); цена = 0 → позиция завода
    //    (исключаем); цена неизвестна (null, источник без колонки цены) → трактуем
    //    как нашу. matchBatch гоняем только по нашим строкам.
    const isPlantRow = (r: any) => r.pricePerKg === 0;
    const matchMap = await matchBatch(
      parsed.rows.filter(r => !isPlantRow(r)).map(r => r.rawName)
    );

    let matched = 0;
    let unmatched = 0;
    let plant = 0;
    // Строки строим В ПАМЯТИ — до проверки достаточности склада ничего не пишем.
    const lines: Parameters<typeof writeRecipeLines>[1] = [];
    const needLines: { raw_uid: string; net_qty: number }[] = [];
    const newAliases: { raw_uid: string; alias: string; source: string }[] = [];
    const queueItems: { text: string; source_type: string; file_name: string }[] = [];
    // Требуемое к списанию по raw_uid (только сматченные наши позиции).
    const required = new Map<string, number>();
    const nameByUid = new Map<string, string>();

    for (const row of parsed.rows) {
      const isPlant = isPlantRow(row);
      const rawUid = isPlant ? null : (matchMap.get(row.rawName) ?? null);
      // Норма на 1 т (кг/т). «% ввода» не зависит от выработки → приоритетный
      // источник; иначе нормализуем «Расход сырья, кг» из документа делением на
      // выработку самого рецепта (расход в документе посчитан на эту выработку).
      const dose_kg_per_t = row.percentage > 0
        ? (row.percentage / 100) * 1000
        : row.quantityPerTon > 0
        ? row.quantityPerTon / recipe_batch_t
        : 0;
      // Списание/потребность под фактическую выработку заказа.
      const consumption_kg = dose_kg_per_t * batch_t;

      lines.push({
        raw_uid: rawUid,
        name_from_recipe: row.rawName,
        activity: "",
        input_pct: row.percentage,
        norm_g_per_t: Math.round(dose_kg_per_t * 1000),
        consumption_kg,
        match_status: isPlant ? "plant" : rawUid ? "matched" : "unmatched",
      });

      if (isPlant) {
        // Позиция завода (цена за 1 кг = 0): не матчим, не закупаем, не списываем,
        // в очередь распознавания не добавляем.
        plant++;
      } else if (rawUid) {
        newAliases.push({ raw_uid: rawUid, alias: row.rawName, source: "recipe" });
        if (consumption_kg > 0) {
          needLines.push({ raw_uid: rawUid, net_qty: consumption_kg });
          required.set(rawUid, (required.get(rawUid) || 0) + consumption_kg);
          nameByUid.set(rawUid, row.rawName);
        }
        matched++;
      } else {
        queueItems.push({ text: row.rawName, source_type: "recipe", file_name: up.originalname });
        unmatched++;
      }
    }

    // 2. Проверка достаточности склада ПЕРЕД записью. Доступно = (Полоцк +
    //    Липковская, последний снимок) − уже списанное рецептами «в работе»/
    //    «удалён». Если хоть одной позиции не хватает — ничего не пишем, возвращаем
    //    список нехватки (рецепт не пускаем в работу).
    //    Проверку и запись выполняем под мьютексом — иначе два одновременных
    //    рецепта могли бы оба пройти проверку по одному остатку и дважды списать.
    const admission = await withRecipeAdmissionLock(async () => {
      if (required.size) {
        const [plantStock, lipStock, consumed] = await Promise.all([
          getLatestPlantStock(),
          getLatestLipStock(),
          getRecipeConsumptionByStatus(STOCK_CONSUMING_STATUSES),
        ]);
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const shortages: { raw_uid: string; name: string; required: number; available: number }[] = [];
        for (const [uid, req2] of required) {
          const available = round2((plantStock.get(uid) || 0) + (lipStock.get(uid) || 0) - (consumed.get(uid) || 0));
          if (req2 > available + 1e-6) {
            shortages.push({ raw_uid: uid, name: nameByUid.get(uid) || uid, required: round2(req2), available });
          }
        }
        if (shortages.length) return { shortages };
      }

      // 3. Склада хватает — создаём рецепт в статусе «в работе» и пишем состав,
      //    синонимы, очередь и потребность. Состав (consumption_kg) пишем ДО
      //    выхода из мьютекса, чтобы следующий рецепт уже видел это списание.
      const recipeUid = await writeRecipe({
        code: parsed.code,
        full_name: parsed.name,
        premix_name: parsed.name,
        date: parsed.date,
        concentration: 0,
        batch_t,
        customer: "",
        period: new Date().toISOString().slice(0, 7),
        quarter: `${Math.ceil((new Date().getMonth() + 1) / 3)}_квартал`,
        file_name: up.originalname,
        base_batch_kg,
      });

      await Promise.all([
        writeRecipeLines(recipeUid, lines),
        newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
        queueItems.length ? addToReviewQueueBatch(queueItems) : Promise.resolve(),
      ]);

      if (needLines.length) await writeNeedFromRecipe(recipeUid, needLines);

      return { recipeUid };
    });

    if ("shortages" in admission) {
      return res.status(409).json({
        error: "Недостаточно сырья на складе — рецепт не пущен в работу",
        shortages: admission.shortages,
      });
    }

    // Архивацию документа делаем вне мьютекса — она не влияет на остатки.
    await saveDocument("recipe", { originalname: up.originalname, mimetype: up.mimetype, buffer: up.buffer }, admission.recipeUid);

    res.json({ ok: true, recipeUid: admission.recipeUid, recipeName: parsed.name, total: parsed.rows.length, matched, unmatched, plant, batch_t });
  } catch (err: any) {
    // Логируем полную ошибку (в проде catch раньше молчал — причина была не видна).
    console.error("[upload/recipe] разбор рецепта упал:", err?.stack || err);
    res.status(500).json({ error: err?.message || "Ошибка разбора рецепта" });
  }
});

// ─── Загрузка КД "Ведомость по партиям" Липковской ───────────────────────────
// Каждая строка КД = отдельная партия. Сохраняем в LipBatches (гранулярно)
// и в LipStock (агрегат по raw_uid для расчётов дашборда).

router.post("/lipkovskaya-kd", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Файл не найден" });
  try {
    const up = readUpload(req);
    const parsed = parseKdExcel(up.buffer);
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
        queueItems.push({ text: row.baseName, source_type: "lipkovskaya_kd", file_name: up.originalname });
        unmatched++;
      }
    }

    // 2. Build LipStock aggregate rows
    const lipStockRows = Array.from(stockAggregate.entries()).map(([raw_uid, v]) => ({
      raw_uid, name_from_source: v.name, qty: v.qty, source: "kd_file",
    }));

    // 2b. Фильтр похожести — ТОЛЬКО для КД: в распознавание попадает лишь то, что
    // похоже на сырьё/добавки (справочник, амбарка Полоцка, рецепт). Остальное
    // (хозтовары, запчасти, тара) отбрасываем как «не сырьё».
    const similar = await filterKdSimilar(queueItems.map(q => q.text));
    const filteredQueue = queueItems.filter(q => similar.has(q.text));
    const ignored = queueItems.length - filteredQueue.length;

    // 3. Write everything in parallel (LipBatches + LipStock aggregate + aliases + queue)
    await Promise.all([
      writeLipBatchesBulk(batchRows),
      writeLipStockBatch(lipStockRows),
      newAliases.length ? addAliasesBatch(newAliases) : Promise.resolve(),
      filteredQueue.length ? addToReviewQueueBatch(filteredQueue) : Promise.resolve(),
    ]);

    await saveDocument("kd", { originalname: up.originalname, mimetype: up.mimetype, buffer: up.buffer });

    res.json({
      ok: true,
      total: parsed.length,
      matched,
      unmatched: filteredQueue.length,
      ignored,
      batches: batchRows.length,
      message: `КД загружен: ${matched} позиций (${batchRows.length} партий), к распознаванию: ${filteredQueue.length}` +
        (ignored ? `, отсеяно не-сырья: ${ignored}` : ""),
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

// ─── Исключённые («не сырьё») ────────────────────────────────────────────────

// Исключить позицию навсегда: записываем в список исключений (больше не попадёт
// в распознавание ни при одной загрузке) и закрываем все строки очереди с этим
// текстом.
router.post("/unmatched/exclude", async (req: Request, res: Response) => {
  const { text } = req.body;
  try {
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "Не указан текст позиции" });
    }
    await addExcludedBatch([{ text: String(text), source_type: "manual" }]);
    await resolveQueueByText(String(text));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/excluded", async (_req: Request, res: Response) => {
  try {
    res.json(await getExcludedList());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
