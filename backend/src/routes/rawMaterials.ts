import { Router, Request, Response } from 'express';
import { pool } from '../app';

const router = Router();

// Все позиции сырья
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, uid, name, avg_monthly_consumption, purchase_threshold FROM raw_materials ORDER BY name'
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Создать новое сырьё
router.post('/', async (req: Request, res: Response) => {
  const { uid, name, avg_monthly_consumption, purchase_threshold } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO raw_materials (uid, name, avg_monthly_consumption, purchase_threshold) VALUES ($1,$2,$3,$4) RETURNING *',
      [uid, name, avg_monthly_consumption, purchase_threshold]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
