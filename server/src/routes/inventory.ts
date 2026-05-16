import { Router, Request, Response } from 'express';
import { pool } from '../index';

const router = Router();

// Остатки Полоцка — последний снимок по каждому сырью
router.get('/polotsk', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (raw_material_id)
        ps.id, ps.raw_material_id, rm.uid, rm.name,
        ps.quantity, ps.date, ps.source_file
      FROM polotsk_stock ps
      JOIN raw_materials rm ON ps.raw_material_id = rm.id
      ORDER BY raw_material_id, date DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Остатки Липковской — последний снимок
router.get('/lipkovskaya', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (raw_material_id)
        ls.id, ls.raw_material_id, rm.uid, rm.name,
        ls.total_quantity, ls.reserve, ls.free_quantity, ls.date
      FROM lipkovskaya_stock ls
      JOIN raw_materials rm ON ls.raw_material_id = rm.id
      ORDER BY raw_material_id, date DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ручной ввод остатков Липковской
router.post('/lipkovskaya', async (req: Request, res: Response) => {
  const { rawMaterialId, totalQuantity, reserve, freeQuantity, date } = req.body;
  try {
    const free = freeQuantity !== undefined ? freeQuantity : (totalQuantity - (reserve || 0));
    const result = await pool.query(
      `INSERT INTO lipkovskaya_stock (raw_material_id, total_quantity, reserve, free_quantity, date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [rawMaterialId, totalQuantity, reserve || 0, free, date || new Date().toISOString().split('T')[0]]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
