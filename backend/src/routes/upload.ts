import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool } from '../app';
import { parsePolotskPdf, parseRecipePdf } from '../services/pdfParser';
import { parsePolotskExcel, parseRecipeExcel } from '../services/excelParser';
import { findRawMaterialBySynonym, addToUnmatchedQueue, addSynonym } from '../services/synonymMatcher';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Загрузка остатков Полоцка (PDF или Excel)
router.post('/polotsk', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не найден' });

  try {
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf');
    const parsed = isPdf
      ? await parsePolotskPdf(req.file.buffer)
      : parsePolotskExcel(req.file.buffer);

    const today = new Date().toISOString().split('T')[0];
    let matched = 0;
    let unmatched = 0;

    for (const row of parsed) {
      const rawId = await findRawMaterialBySynonym(row.rawName);
      if (rawId) {
        await pool.query(
          `INSERT INTO polotsk_stock (raw_material_id, quantity, date, source_file)
           VALUES ($1,$2,$3,$4)`,
          [rawId, row.quantity, today, req.file.originalname]
        );
        await addSynonym(rawId, row.rawName, 'file');
        matched++;
      } else {
        await addToUnmatchedQueue(row.rawName, 'polotsk', req.file.originalname);
        unmatched++;
      }
    }

    res.json({
      ok: true,
      total: parsed.length,
      matched,
      unmatched,
      message: `Загружено: ${matched}, не распознано: ${unmatched}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Загрузка рецепта (PDF или Excel)
router.post('/recipe', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не найден' });

  try {
    const isPdf = req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf');
    const parsed = isPdf
      ? await parseRecipePdf(req.file.buffer)
      : parseRecipeExcel(req.file.buffer);

    // Создаём рецепт
    const recipeResult = await pool.query(
      `INSERT INTO recipes (name, code, date, file_name)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [parsed.name, parsed.code, parsed.date, req.file.originalname]
    );
    const recipeId = recipeResult.rows[0].id;

    let matched = 0;
    let unmatched = 0;

    for (const row of parsed.rows) {
      const rawId = await findRawMaterialBySynonym(row.rawName);
      await pool.query(
        `INSERT INTO recipe_lines (recipe_id, raw_material_id, percentage, quantity_per_ton)
         VALUES ($1,$2,$3,$4)`,
        [recipeId, rawId || null, row.percentage, row.quantityPerTon]
      );
      if (rawId) {
        await addSynonym(rawId, row.rawName, 'recipe');
        matched++;
      } else {
        await addToUnmatchedQueue(row.rawName, 'recipe', req.file.originalname);
        unmatched++;
      }
    }

    res.json({
      ok: true,
      recipeId,
      recipeName: parsed.name,
      total: parsed.rows.length,
      matched,
      unmatched
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Нераспознанные строки для ручной проверки
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, original_text, source_type, file_name, created_at
       FROM unmatched_queue WHERE resolved=false ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Подтвердить маппинг из очереди
router.post('/unmatched/confirm', async (req: Request, res: Response) => {
  const { queueId, rawMaterialId } = req.body;
  try {
    const q = await pool.query('SELECT original_text, source_type FROM unmatched_queue WHERE id=$1', [queueId]);
    if (!q.rows.length) return res.status(404).json({ error: 'Не найдено' });
    const { original_text, source_type } = q.rows[0];
    await addSynonym(rawMaterialId, original_text, source_type);
    await pool.query('UPDATE unmatched_queue SET resolved=true WHERE id=$1', [queueId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
