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
  RECIPE_STATUS,
} from "../services/sheetsService";

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
  const needRemoved = await deleteNeedByRecipe(uid);
  const found = await setRecipeStatus(uid, status);
  return { found, needRemoved };
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
