import { Router, Request, Response } from 'express';
import { pool } from '../index';
import * as XLSX from 'xlsx';

const router = Router();

// Главный запрос — управленческие решения
router.get('/decisions', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        rm.id,
        rm.uid                             AS "код сырья",
        rm.name                            AS "наименование",
        rm.avg_monthly_consumption         AS "среднемесячный расход",
        rm.purchase_threshold              AS "порог закупки",
        COALESCE(ps.quantity, 0)           AS "остаток Полоцк",
        COALESCE(ls.free_quantity, 0)      AS "свободно Липковская",
        COALESCE(it.qty, 0)                AS "в пути",
        COALESCE(n.planned_requirement, 0) AS "плановая потребность",
        (COALESCE(ps.quantity,0) + COALESCE(ls.free_quantity,0) + COALESCE(it.qty,0)) AS "доступно",
        GREATEST(0,
          COALESCE(n.planned_requirement,0)
          - COALESCE(ps.quantity,0)
          - COALESCE(ls.free_quantity,0)
          - COALESCE(it.qty,0)
        ) AS "закупка",
        CASE
          WHEN (COALESCE(ps.quantity,0) + COALESCE(ls.free_quantity,0) + COALESCE(it.qty,0))
               < COALESCE(n.planned_requirement,0)
          THEN 'СРОЧНО ЗАКУПАТЬ'
          WHEN (COALESCE(ps.quantity,0) + COALESCE(ls.free_quantity,0))
               < COALESCE(n.planned_requirement,0) * 0.3
          THEN 'ПЛАНИРОВАТЬ ЗАКУПКУ'
          WHEN COALESCE(ls.free_quantity,0) > 0
               AND COALESCE(ps.quantity,0) < COALESCE(n.planned_requirement,0) * 0.2
          THEN 'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ'
          ELSE 'ЗАПАС В НОРМЕ'
        END AS "статус"
      FROM raw_materials rm
      LEFT JOIN (
        SELECT DISTINCT ON (raw_material_id)
          raw_material_id, quantity
        FROM polotsk_stock ORDER BY raw_material_id, date DESC
      ) ps ON rm.id = ps.raw_material_id
      LEFT JOIN (
        SELECT DISTINCT ON (raw_material_id)
          raw_material_id, free_quantity
        FROM lipkovskaya_stock ORDER BY raw_material_id, date DESC
      ) ls ON rm.id = ls.raw_material_id
      LEFT JOIN (
        SELECT raw_material_id, SUM(quantity) AS qty
        FROM in_transit WHERE status != 'принято'
        GROUP BY raw_material_id
      ) it ON rm.id = it.raw_material_id
      LEFT JOIN (
        SELECT DISTINCT ON (raw_material_id)
          raw_material_id, planned_requirement
        FROM need ORDER BY raw_material_id, date DESC
      ) n ON rm.id = n.raw_material_id
      ORDER BY
        CASE
          WHEN (COALESCE(ps.quantity,0)+COALESCE(ls.free_quantity,0)+COALESCE(it.qty,0)) < COALESCE(n.planned_requirement,0) THEN 1
          WHEN (COALESCE(ps.quantity,0)+COALESCE(ls.free_quantity,0)) < COALESCE(n.planned_requirement,0)*0.3 THEN 2
          ELSE 3
        END, rm.name
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Экспорт в Excel
router.get('/export', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        rm.uid AS "Код сырья", rm.name AS "Наименование",
        COALESCE(ps.quantity,0) AS "Полоцк КХП, кг",
        COALESCE(ls.free_quantity,0) AS "Свободно Липковская, кг",
        COALESCE(it.qty,0) AS "В пути, кг",
        COALESCE(n.planned_requirement,0) AS "Плановая потребность, кг",
        GREATEST(0, COALESCE(n.planned_requirement,0) - COALESCE(ps.quantity,0)
          - COALESCE(ls.free_quantity,0) - COALESCE(it.qty,0)) AS "Закупить, кг",
        CASE
          WHEN (COALESCE(ps.quantity,0)+COALESCE(ls.free_quantity,0)+COALESCE(it.qty,0)) < COALESCE(n.planned_requirement,0) THEN 'СРОЧНО ЗАКУПАТЬ'
          WHEN (COALESCE(ps.quantity,0)+COALESCE(ls.free_quantity,0)) < COALESCE(n.planned_requirement,0)*0.3 THEN 'ПЛАНИРОВАТЬ ЗАКУПКУ'
          WHEN COALESCE(ls.free_quantity,0) > 0 AND COALESCE(ps.quantity,0) < COALESCE(n.planned_requirement,0)*0.2 THEN 'ПЕРЕВЕЗТИ С ЛИПКОВСКОЙ'
          ELSE 'ЗАПАС В НОРМЕ'
        END AS "Статус"
      FROM raw_materials rm
      LEFT JOIN (SELECT DISTINCT ON (raw_material_id) raw_material_id, quantity FROM polotsk_stock ORDER BY raw_material_id, date DESC) ps ON rm.id = ps.raw_material_id
      LEFT JOIN (SELECT DISTINCT ON (raw_material_id) raw_material_id, free_quantity FROM lipkovskaya_stock ORDER BY raw_material_id, date DESC) ls ON rm.id = ls.raw_material_id
      LEFT JOIN (SELECT raw_material_id, SUM(quantity) AS qty FROM in_transit WHERE status!='принято' GROUP BY raw_material_id) it ON rm.id = it.raw_material_id
      LEFT JOIN (SELECT DISTINCT ON (raw_material_id) raw_material_id, planned_requirement FROM need ORDER BY raw_material_id, date DESC) n ON rm.id = n.raw_material_id
      ORDER BY rm.name
    `);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(result.rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Решения');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="decisions_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Последнее обновление данных
router.get('/status', async (req: Request, res: Response) => {
  try {
    const polotsk = await pool.query('SELECT MAX(date) as last FROM polotsk_stock');
    const lipkovskaya = await pool.query('SELECT MAX(date) as last FROM lipkovskaya_stock');
    const transit = await pool.query('SELECT COUNT(*) as count FROM in_transit WHERE status!=\'принято\'');
    const unmatched = await pool.query('SELECT COUNT(*) as count FROM unmatched_queue WHERE resolved=false');
    res.json({
      polotsk_last: polotsk.rows[0].last,
      lipkovskaya_last: lipkovskaya.rows[0].last,
      transit_count: transit.rows[0].count,
      unmatched_count: unmatched.rows[0].count,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
