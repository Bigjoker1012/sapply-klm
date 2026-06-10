/**
 * Рецепты премиксов. Эндпоинты:
 *   GET  /api/recipes                — список рецептов со статусами
 *   GET  /api/recipes/:uid/lines     — состав конкретного рецепта
 *   POST /api/recipes/:uid/cancel    — отменить (статус «отменён», сырьё
 *                                      возвращается в общие остатки)
 *   POST /api/recipes/:uid/archive   — удалить в архив (статус «удалён», сырьё
 *                                      НЕ возвращается — остаётся списанным)
 *   POST /api/recipes/bulk           — групповая операция над несколькими
 *                                      рецептами { uids: [...], action }
 *
 * Источник данных: Google Sheets (листы Recipes / RecipeLines), куда пишет
 * разбор рецепта (routes/upload.ts). «Живые остатки» вычитают потребление
 * рецептов в статусах «в работе» и «удалён».
 *
 * Доступ только для авторизованных: requireAuth навешан на весь роутер.
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  getRecipesList, getRecipeLines, setRecipeStatus, deleteNeedByRecipe,
  updateRecipeTons, getLiveStock, writeNeedFromRecipe,
  RECIPE_STATUS, STOCK_CONSUMING_STATUSES,
} from "../services/sheetsService";
import { withStockMutation } from "../services/stockMutex";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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

/**
 * Меняет статус рецепта и снимает его потребность (Need). Порядок важен: сперва
 * удаляем Need (идемпотентно, повтор безопасен), потом ставим статус. Если запись
 * статуса упадёт, рецепт останется в прежнем (рабочем) статусе и операцию можно
 * безопасно повторить — мы не оставим «завершённый» рецепт со старым Need.
 */
async function transitionRecipe(uid: string, status: string): Promise<{ found: boolean; needRemoved: number }> {
  // Под общим мьютексом склада: смена статуса меняет эффективное списание
  // (отмена возвращает сырьё), поэтому нельзя пересекаться с приёмом рецепта и
  // изменением выработки, которые проверяют достаточность по тем же остаткам.
  return withStockMutation(async () => {
    const needRemoved = await deleteNeedByRecipe(uid);
    const found = await setRecipeStatus(uid, status);
    return { found, needRemoved };
  });
}

/** Отмена рецепта: статус «отменён», сырьё возвращается в остатки, потребность снимается. */
router.post("/:uid/cancel", async (req: Request, res: Response) => {
  try {
    const { found, needRemoved } = await transitionRecipe(req.params.uid, RECIPE_STATUS.CANCELLED);
    if (!found) return res.status(404).json({ error: "Рецепт не найден" });
    res.json({ ok: true, status: RECIPE_STATUS.CANCELLED, needRemoved });
  } catch (err: any) {
    console.error("[recipes/cancel]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Удаление в архив: статус «удалён», сырьё НЕ возвращается, потребность снимается. */
router.post("/:uid/archive", async (req: Request, res: Response) => {
  try {
    const { found, needRemoved } = await transitionRecipe(req.params.uid, RECIPE_STATUS.DELETED);
    if (!found) return res.status(404).json({ error: "Рецепт не найден" });
    res.json({ ok: true, status: RECIPE_STATUS.DELETED, needRemoved });
  } catch (err: any) {
    console.error("[recipes/archive]", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Изменение выработки (тонн) у рецепта в работе: { tons: number }. Расход по
 * строкам пересчитывается пропорционально. Остатки считаются динамически, поэтому
 * при уменьшении лишнее сырьё автоматически возвращается; при увеличении сначала
 * проверяем, хватит ли склада на ДОПОЛНИТЕЛЬНУЮ потребность (дельту) — если нет,
 * ничего не меняем и возвращаем 409 со списком нехватки. Вся проверка+запись —
 * под общим мьютексом склада.
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
      if (!STOCK_CONSUMING_STATUSES.has(rec.status)) {
        return { kind: "badStatus" as const, status: rec.status };
      }
      const oldBatchT = rec.batch_t || (rec.base_batch_kg / 1000) || 1;

      // Увеличение выработки → нужна дополнительная (дельта) потребность. Доступно
      // (getLiveStock.available) уже учитывает текущее списание этого рецепта.
      if (tons > oldBatchT) {
        const factor = tons / oldBatchT;
        const [lines, live] = await Promise.all([
          getRecipeLines(req.params.uid),
          getLiveStock(),
        ]);
        const availByUid = new Map(live.map(r => [r.raw_uid, r.available]));
        // Агрегируем дельту по raw_uid: одно и то же сырьё может встречаться в
        // нескольких строках рецепта — иначе каждая строка прошла бы проверку
        // по отдельности, а сумма превысила бы остаток.
        const deltaByUid = new Map<string, { name: string; delta: number }>();
        for (const l of lines) {
          if (!l.raw_uid || l.match_status !== "matched" || !(l.consumption_kg > 0)) continue;
          const d = l.consumption_kg * (factor - 1);
          const cur = deltaByUid.get(l.raw_uid);
          if (cur) cur.delta += d;
          else deltaByUid.set(l.raw_uid, { name: l.name_from_recipe, delta: d });
        }
        const shortages: { raw_uid: string; name: string; required: number; available: number }[] = [];
        for (const [rawUid, { name, delta }] of deltaByUid) {
          const required = round2(delta);
          const available = availByUid.get(rawUid) ?? 0;
          if (required > available + 1e-6) {
            shortages.push({ raw_uid: rawUid, name, required, available });
          }
        }
        if (shortages.length) return { kind: "shortages" as const, shortages };
      }

      const upd = await updateRecipeTons(req.params.uid, tons);
      // Потребность (план закупки) пересчитываем под новую выработку.
      await deleteNeedByRecipe(req.params.uid);
      if (upd.needLines.length) await writeNeedFromRecipe(req.params.uid, upd.needLines);
      return { kind: "ok" as const, oldBatchT: upd.oldBatchT, newBatchT: tons };
    });

    if (result.kind === "notFound") return res.status(404).json({ error: "Рецепт не найден" });
    if (result.kind === "badStatus") {
      return res.status(400).json({ error: `Менять выработку можно только у рецепта «в работе» (статус: ${result.status})` });
    }
    if (result.kind === "shortages") {
      return res.status(409).json({ error: "Недостаточно сырья для увеличения выработки", shortages: result.shortages });
    }
    res.json({ ok: true, oldBatchT: result.oldBatchT, newBatchT: result.newBatchT });
  } catch (err: any) {
    console.error("[recipes/tons]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Групповая операция: { uids: string[], action: 'cancel' | 'archive' }. */
router.post("/bulk", async (req: Request, res: Response) => {
  const uids: string[] = Array.isArray(req.body?.uids) ? req.body.uids : [];
  const action = String(req.body?.action || "");
  if (!uids.length) return res.status(400).json({ error: "Не выбраны рецепты" });
  const status =
    action === "cancel" ? RECIPE_STATUS.CANCELLED :
    action === "archive" ? RECIPE_STATUS.DELETED : null;
  if (!status) return res.status(400).json({ error: "Недопустимое действие" });
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
