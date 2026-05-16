import { Router, Request, Response } from 'express';
import { pool } from '../app';

const router = Router();

// Все поставки в пути
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT it.id, it.raw_material_id, rm.uid, rm.name,
             it.quantity, it.eta, it.direction, it.status, it.comment, it.created_at
      FROM in_transit it
      JOIN raw_materials rm ON it.raw_material_id = rm.id
      WHERE it.status != 'принято'
      ORDER BY it.eta ASC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить поставку в пути
router.post('/', async (req: Request, res: Response) => {
  const { rawMaterialId, quantity, eta, direction, comment } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO in_transit (raw_material_id, quantity, eta, direction, status, comment)
       VALUES ($1,$2,$3,$4,'ожидается',$5) RETURNING *`,
      [rawMaterialId, quantity, eta, direction || '', comment || '']
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Изменить статус поставки
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  try {
    const result = await pool.query(
      'UPDATE in_transit SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Удалить поставку
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM in_transit WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
