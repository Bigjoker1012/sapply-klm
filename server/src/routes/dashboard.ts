import { Router, Request, Response } from "express";
import { computeDecisions, readRange } from "../services/sheetsService";
import * as XLSX from "xlsx";

const router = Router();

router.get("/decisions", async (_req: Request, res: Response) => {
  try {
    const decisions = await computeDecisions();
    res.json(decisions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const [plant, inbound, queue] = await Promise.all([
      readRange("PlantStock", "A2:A5000"),
      readRange("Inbound", "A2:G5000"),
      readRange("ReviewQueue", "A2:E5000"),
    ]);
    const lastPlant = plant.filter(r => r[0]).pop()?.[0] || null;
    const activeInbound = inbound.filter(r => r[0] && !["получено", "удалено"].includes(String(r[6] || "").toLowerCase())).length;
    const unresolvedQueue = queue.filter(r => r[0] && String(r[4] || "").toUpperCase() !== "TRUE").length;
    res.json({
      plant_last_update: lastPlant,
      active_inbound_count: activeInbound,
      unresolved_review_count: unresolvedQueue,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/export", async (_req: Request, res: Response) => {
  try {
    const decisions = await computeDecisions();
    const rows = decisions.map(d => ({
      "Код сырья": d.raw_uid,
      "Наименование": d.name,
      "Ср. расход кг/мес": d.avg_monthly_usage,
      "Порог закупки кг": d.threshold_qty,
      "Полоцк кг": d.plant_qty,
      "Липковская кг": d.lip_qty,
      "В пути кг": d.inbound_qty,
      "Потребность кг": d.planned_need,
      "Доступно кг": d.available_total,
      "Ост. после плана кг": d.expected_after_plan,
      "Статус": d.status,
      "Переброска с Липковской кг": d.cover_by_transfer,
      "Закупить кг": d.cover_by_purchase,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Решения");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="decisions_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
