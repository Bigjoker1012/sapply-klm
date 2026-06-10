/**
 * Рецепты премиксов. Эндпоинты:
 *   GET  /api/recipes                — список рецептов со статусами
 *   GET  /api/recipes/:uid/lines     — состав конкретного рецепта
 *   POST /api/recipes/:uid/status    — сменить статус { status: plan|archive|cancel }.
 *                                      Рецепт НЕ удаляется физически. «отмена»
 *                                      возвращает сырьё; «план»/«архив» списывают.
 *   POST /api/recipes/:uid/tons      — изменить выработку (нехватка НЕ блокирует)
 *   POST /api/recipes/bulk           — групповая смена статуса { uids, status }
 *
 * Источник данных: Google Sheets (листы Recipes / RecipeLines), куда пишет
 * разбор рецепта (routes/upload.ts). «Живые остатки» вычитают потребление
 * всех рецептов, кроме «отменён».
 *
 * Доступ только для авторизованных: requireAuth навешан на весь роутер.
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  getRecipesList, getRecipeLines, setRecipeStatus, deleteNeedByRecipe,
  updateRecipeTons, writeNeedFromRecipe, RECIPE_STATUS,
} from "../services/sheetsService";
import { withStockMutation } from "../services/stockMutex";

const router = Router();

router.use(requireAuth);

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await getRecipesList());
  } catch (err: any) {
    console.error("[recipes/list]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:uid/lines", async (req: Request, res: Response) => {
  try {
    res.json(await getRecipeLines(req.params.uid));
  } catch (err: any) {
    console.error("[recipes/lines]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Маппинг действия с фронта в целевой статус рецепта. */
const ACTION_STATUS: Record<string, string> = {
  plan: RECIPE_STATUS.PLAN,
  archive: RECIPE_STATUS.ARCHIVED,
  cancel: RECIPE_STATUS.CANCELLED,
};

/**
 * Меняет статус рецепта и пересчитывает его потребность (Need). Рецепт НИКОГДА не
 * удаляется физически — только меняется статус. Под общим мьютексом склада: смена
 * статуса меняет эффективное списание (отмена возвращает сырьё, план/архив —
 * списывают), поэтому нельзя пересекаться с приёмом рецепта и изменением
 * выработки. Need: при отмене удаляем, иначе пересчитываем из текущих строк.
 */
async function transitionRecipe(uid: string, status: string): Promise<{ found: boolean }> {
  return withStockMutation(async () => {
    const found = await setRecipeStatus(uid, status);
    if (!found) return { found };
    await deleteNeedByRecipe(uid);
    if (status !== RECIPE_STATUS.CANCELLED) {
      const lines = await getRecipeLines(uid);
      const needLines = lines
        .filter(l => l.raw_uid && l.match_status === "matched" && l.consumption_kg > 0)
        .map(l => ({ raw_uid: l.raw_uid as string, net_qty: l.consumption_kg as number }));
      if (needLines.length) await writeNeedFromRecipe(uid, needLines);
    }
    return { found };
  });
}

/**
 * Смена статуса одного рецепта: { status: 'plan' | 'archive' | 'cancel' }.
 *   plan    → «план»   (сырьё зарезервировано/списано);
 *   archive → «архив»  (выработан, сырьё остаётся списанным);
 *   cancel  → «отменён» (сырьё возвращается в остатки).
 */
router.post("/:uid/status", async (req: Request, res: Response) => {
  const status = ACTION_STATUS[String(req.body?.status || "")];
  if (!status) return res.status(400).json({ error: "Недопустимый статус" });
  try {
    const { found } = await transitionRecipe(req.params.uid, status);
    if (!found) return res.status(404).json({ error: "Рецепт не найден" });
    res.json({ ok: true, status });
  } catch (err: any) {
    console.error("[recipes/status]", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Изменение выработки (тонн) у рецепта: { tons: number }. Расход по строкам
 * пересчитывается пропорционально. Остатки считаются динамически: при уменьшении
 * лишнее сырьё возвращается, при увеличении нехватка НЕ блокирует — склад уходит
 * в минус и попадает в сигнал к закупке. Блокируется только отменённый рецепт.
 * Пересчёт+запись — под общим мьютексом склада.
 */
router.post("/:uid/tons", async (req: Request, res: Response) => {
  const tons = parseFloat(String(req.body?.tons ?? "").replace(",", "."));
  if (!Number.isFinite(tons) || tons <= 0) {
    return res.status(400).json({ error: "Укажите выработку (т) больше 0" });
  }
  try {
    const result = await withStockMutation(async () => {
      const recipes = await getRecipesList();
      const rec = recipes.find(r => r.recipe_uid === req.params.uid);
      if (!rec) return { kind: "notFound" as const };
      if (rec.status === RECIPE_STATUS.CANCELLED) {
        return { kind: "badStatus" as const, status: rec.status };
      }

      // Нехватка склада НЕ блокирует: остаток уходит в минус, сигнал к закупке
      // формируется на вкладке «Дефицит». Просто масштабируем расход и Need.
      const upd = await updateRecipeTons(req.params.uid, tons);
      await deleteNeedByRecipe(req.params.uid);
      if (upd.needLines.length) await writeNeedFromRecipe(req.params.uid, upd.needLines);
      return { kind: "ok" as const, oldBatchT: upd.oldBatchT, newBatchT: tons };
    });

    if (result.kind === "notFound") return res.status(404).json({ error: "Рецепт не найден" });
    if (result.kind === "badStatus") {
      return res.status(400).json({ error: `Нельзя менять выработку у отменённого рецепта (статус: ${result.status})` });
    }
    res.json({ ok: true, oldBatchT: result.oldBatchT, newBatchT: result.newBatchT });
  } catch (err: any) {
    console.error("[recipes/tons]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Групповая операция: { uids: string[], status: 'plan' | 'archive' | 'cancel' }. */
router.post("/bulk", async (req: Request, res: Response) => {
  const uids: string[] = Array.isArray(req.body?.uids) ? req.body.uids : [];
  const status = ACTION_STATUS[String(req.body?.status || "")];
  if (!uids.length) return res.status(400).json({ error: "Не выбраны рецепты" });
  if (!status) return res.status(400).json({ error: "Недопустимый статус" });
  try {
    let done = 0;
    const failed: string[] = [];
    for (const uid of uids) {
      try {
        const { found } = await transitionRecipe(uid, status);
        if (found) done++; else failed.push(uid);
      } catch {
        failed.push(uid);
      }
    }
    res.json({ ok: true, status, done, failed });
  } catch (err: any) {
    console.error("[recipes/bulk]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
