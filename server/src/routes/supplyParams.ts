/**
 * Supply params — единый эндпоинт для рабочего интерфейса закупок.
 * GET /api/supply/params — все активные SKU с расчётом рекомендации.
 */
import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth/middleware";
import { getLiveStock } from "../services/postgresSupplyService";
import { computePlanningRows } from "../services/planningStatus";

const router = Router();
router.use(requireAuth);

router.get("/params", async (_req: Request, res: Response) => {
  try {
    const [liveStock, planning, skuParams] = await Promise.all([
      getLiveStock(),
      computePlanningRows(),
      db.execute(sql`
        SELECT s.code, s.name, s.min_stock_kg, s.purchase_coefficient,
               s.purchase_threshold_months, s.purchase_batch_kg,
               s.lead_time_days, s.purchase_mode, s.purchase_status, s.purchase_comment
        FROM sku s WHERE s.active = true ORDER BY s.code
      `),
    ]);

    const liveMap = new Map(liveStock.map(l => [l.raw_uid, l]));
    const planMap = new Map(planning.map(p => [p.raw_uid, p]));

    const result = skuParams.rows.map(p => {
      const code = p.code as string;
      const live = liveMap.get(code);
      const plan = planMap.get(code);

      const avg = parseFloat(p.manual_avg_usage as any) || (plan?.avg_monthly_usage ?? 0) || 0;
      const minSt = parseFloat(p.min_stock_kg as any) || 0;
      const coeff = parseFloat(p.purchase_coefficient as any) || 1.0;
      const stock = live ? (live.plant_qty + live.lip_qty) : 0;
      const plantStock = live ? live.plant_qty : 0;
      const lipStock = live ? live.lip_qty : 0;
      const planNeed = plan?.planned_need ?? 0;
      const inboundQty = live?.inbound_qty ?? 0;

      const stockAfterPlan = Math.max(0, stock - planNeed);
      const targetStock = Math.max(avg * coeff, minSt);
      const purchaseRec = Math.max(0, targetStock - stockAfterPlan);

      let signal: string = 'ok';
      if (stockAfterPlan <= minSt && minSt > 0) signal = 'critical';
      else if (stockAfterPlan < targetStock && targetStock > 0) signal = 'attention';

      return {
        code,
        name: p.name,
        stock, plantStock, lipStock,
        planNeed,
        avg3m: avg,
        minStock: minSt,
        coeff,
        targetStock,
        stockAfterPlan,
        purchaseRec,
        signal,
        inboundQty,
        thresholdMonths: p.purchase_threshold_months,
        batchKg: p.purchase_batch_kg,
        leadTimeDays: p.lead_time_days,
        mode: p.purchase_mode,
        status: p.purchase_status || 'active',
        comment: p.purchase_comment,
      };
    });

    // Sort: critical first, then attention, then ok; within group by purchaseRec desc
    const signalOrder: Record<string, number> = { critical: 0, attention: 1, ok: 2 };
    result.sort((a: any, b: any) => {
      const sa = signalOrder[a.signal] ?? 3;
      const sb = signalOrder[b.signal] ?? 3;
      if (sa !== sb) return sa - sb;
      return b.purchaseRec - a.purchaseRec;
    });

    res.json(result);
  } catch (err: any) {
    console.error("[supply/params]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
