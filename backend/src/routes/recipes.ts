import { Router, Request, Response } from 'express';
import { pool } from '../app';

const router = Router();

// Список рецептов
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recipes ORDER BY date DESC'
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Строки рецепта
router.get('/:id/lines', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT rl.id, rl.recipe_id, rl.raw_material_id,
             rm.uid, rm.name,
             rl.percentage, rl.quantity_per_ton
      FROM recipe_lines rl
      LEFT JOIN raw_materials rm ON rl.raw_material_id = rm.id
      WHERE rl.recipe_id = $1
      ORDER BY rl.id
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
