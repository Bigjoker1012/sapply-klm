import { Router, Request, Response } from 'express';
import { pool } from '../index';

const router = Router();

// Все синонимы (с именем сырья)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT ms.id, ms.synonym, ms.source, ms.created_at,
             rm.id as raw_material_id, rm.uid, rm.name
      FROM material_synonyms ms
      JOIN raw_materials rm ON ms.raw_material_id = rm.id
      ORDER BY rm.name, ms.synonym
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Нераспознанные строки (из очереди на проверку)
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, original_text, source_type, file_name, created_at
      FROM unmatched_queue
      WHERE resolved = false
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Подтвердить маппинг нераспознанной строки
router.post('/confirm', async (req: Request, res: Response) => {
  const { queueId, rawMaterialId, synonym } = req.body;
  try {
    await pool.query(
      `INSERT INTO material_synonyms (raw_material_id, synonym, source)
       VALUES ($1, $2, 'manual')
       ON CONFLICT (raw_material_id, synonym) DO NOTHING`,
      [rawMaterialId, synonym]
    );
    await pool.query('UPDATE unmatched_queue SET resolved = true WHERE id = $1', [queueId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить синоним вручную
router.post('/', async (req: Request, res: Response) => {
  const { rawMaterialId, synonym, source } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO material_synonyms (raw_material_id, synonym, source)
       VALUES ($1,$2,$3)
       ON CONFLICT (raw_material_id, synonym) DO NOTHING
       RETURNING *`,
      [rawMaterialId, synonym, source || 'manual']
    );
    res.json(result.rows[0] || { message: 'already exists' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить синоним
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM material_synonyms WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
