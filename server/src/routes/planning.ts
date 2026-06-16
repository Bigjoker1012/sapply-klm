/**
 * Планирование закупок по сырью. Страница «Планирование закупок».
 *   GET   /api/planning            — список SKU + кол-во сегодня + настройки
 *   PATCH /api/planning/:raw_uid   — сохранить коэффициент / ручной ввод / расход
 *
 * «Кол-во сегодня» = остатки Полоцк + Липковская + в пути − потребность по
 * рецептам в списывающих статусах (план/в работе; выработанные/архив уже учтены
 * в новом остатке склада — см. STOCK_CONSUMING_STATUSES). Среднемесячный расход
 * авто НЕ считаем (нет истории расхода) — только ручной ввод; иначе поле пустое.
 * coefficient — «ручной коэф-т» (запас под срок поставки): 1.0–2.0, по умолч. 1.
 * Статус/светофор считается на клиенте: коэф-т потребности = наличие/ср.расход,
 * итог = коэф-т потребности × ручной коэф-т; >1.5 норма, 1–1.5 контроль,
 * 0.6–1 закупка, <0.6 срочная закупка.
 */
import { Router, Request, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { db } from "../db/client";
import { requireAuth } from "../auth/middleware";
import {
  getAllRawMaterials,
  getLatestPlantStock,
  getLatestLipStock,
  getInboundTotals,
  getNeedTotals,
} from "../services/sheetsService";

const router = Router();
router.use(requireAuth);

interface PlanningRow {
  raw_uid: string;
  name: string;
  unit: string;
  qty_today: number;
  /** Среднемес. расход: число при ручном вводе, иначе null (авто пока нет) */
  avg_monthly_usage: number | null;
  coefficient: number;
  manual_input: boolean;
  manual_avg_usage: number | null;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    // Остатки и каталог берём из Google Sheets — это фактический источник
    // введённых пользователем данных (Полоцк + Липковская + в пути).
    // Из остатка вычитаем потребность по рецептам (лист Need) — рецепт
    // «списывается» и в планировании. Настройки (коэффициент / ручной
    // ввод) — из Postgres.
    const [catalog, plant, lip, inbound, need, settingRes] = await Promise.all([
      getAllRawMaterials(),
      getLatestPlantStock(),
      getLatestLipStock(),
      getInboundTotals(),
      getNeedTotals(),
      db.execute(sql`SELECT sku_code, coefficient, manual_input, manual_avg_usage FROM purchase_plan_setting`),
    ]);

    const settings = new Map<string, { coefficient: number; manual_input: boolean; manual_avg_usage: number | null }>();
    for (const r of settingRes.rows as Array<{ sku_code: string; coefficient: number | null; manual_input: boolean | null; manual_avg_usage: number | null }>) {
      settings.set(String(r.sku_code), {
        // Ручной коэф-т 1.0–2.0; легаси-значения < 1 поднимаем до 1.
        coefficient: Math.min(2, Math.max(1, Number(r.coefficient ?? 1) || 1)),
        manual_input: r.manual_input === true,
        manual_avg_usage: r.manual_avg_usage ?? null,
      });
    }

    const result: PlanningRow[] = catalog
      .filter(m => m.active)
      .map(m => {
        const s = settings.get(m.raw_uid);
        const manual_input = s?.manual_input ?? false;
        const manual_avg_usage = s?.manual_avg_usage ?? null;
        // Остаток на руках за вычетом потребности по рецептам. Не может быть
        // отрицательным: если рецепты требуют больше, чем есть — на руках 0,
        // а дефицит закрывается закупкой (отдельный расчёт), не «минусом».
        const qty_raw =
          (plant.get(m.raw_uid) || 0) +
          (lip.get(m.raw_uid) || 0) +
          (inbound.get(m.raw_uid) || 0) -
          (need.get(m.raw_uid) || 0);
        const qty_today = Math.max(0, Math.round((qty_raw + Number.EPSILON) * 100) / 100);
        return {
          raw_uid: m.raw_uid,
          name: m.full_name,
          unit: m.unit,
          qty_today,
          avg_monthly_usage: manual_input ? manual_avg_usage : null,
          coefficient: s?.coefficient ?? 1,
          manual_input,
          manual_avg_usage,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    res.json(result);
  } catch (err: any) {
    console.error("[planning/get]", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:raw_uid", async (req: Request, res: Response) => {
  try {
    const skuCode = req.params.raw_uid;
    const body = req.body ?? {};

    const fields: { coefficient?: number; manualInput?: boolean; manualAvgUsage?: number | null } = {};

    if (body.coefficient !== undefined) {
      const n = Number(body.coefficient);
      if (!Number.isFinite(n)) return res.status(400).json({ error: "coefficient некорректен" });
      // Ручной коэф-т (запас под срок поставки): 1.0–2.0, по умолчанию 1.
      fields.coefficient = Math.min(2, Math.max(1, n));
    }
    if (body.manual_input !== undefined) {
      fields.manualInput = !!body.manual_input;
    }
    if (body.manual_avg_usage !== undefined) {
      const raw = body.manual_avg_usage;
      const v = raw === null || raw === "" ? null : Math.max(0, Number(raw));
      if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: "manual_avg_usage некорректен" });
      fields.manualAvgUsage = v;
    }

    // Гарантируем строку с дефолтами, затем точечно обновляем переданные поля.
    await db.execute(sql`
      INSERT INTO purchase_plan_setting (sku_code) VALUES (${skuCode})
      ON CONFLICT (sku_code) DO NOTHING
    `);

    const sets: SQL[] = [
      sql`updated_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    ];
    if (fields.coefficient !== undefined) sets.push(sql`coefficient = ${fields.coefficient}`);
    if (fields.manualInput !== undefined) sets.push(sql`manual_input = ${fields.manualInput}`);
    if (fields.manualAvgUsage !== undefined) sets.push(sql`manual_avg_usage = ${fields.manualAvgUsage}`);

    await db.execute(sql`
      UPDATE purchase_plan_setting SET ${sql.join(sets, sql`, `)}
      WHERE sku_code = ${skuCode}
    `);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[planning/patch]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
