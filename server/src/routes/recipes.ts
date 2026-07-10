/**
 * Рецепты премиксов. Эндпоинты:
 *   GET  /api/recipes                — список рецептов со статусами
 *   GET  /api/recipes/:uid/lines     — состав конкретного рецепта
 *   POST /api/recipes/:uid/status    — сменить статус { status: plan|archive|cancel }.
 *                                      Рецепт НЕ удаляется физически. Списывают
 *                                      только «план»/«в работе»; «архив» (выработан)
 *                                      и «отмена» — НЕ списывают.
 *   POST /api/recipes/:uid/tons      — изменить выработку (нехватка НЕ блокирует)
 *   POST /api/recipes/bulk           — групповая смена статуса { uids, status }
 *
 * Источник данных: Google Sheets (листы Recipes / RecipeLines), куда пишет
 * разбор рецепта (routes/upload.ts). «Живые остатки» вычитают потребление
 * рецептов в списывающих статусах (план / в работе) — см.
 * STOCK_CONSUMING_STATUSES; выработанные (архив) и отменённые не вычитаются.
 *
 * Доступ только для авторизованных: requireAuth навешан на весь роутер.
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  getRecipesList, getRecipeLines, setRecipeStatus, deleteNeedByRecipe, deleteRecipe, deleteRecipesBulk,
  updateRecipeTons, writeNeedFromRecipe, RECIPE_STATUS, STOCK_CONSUMING_STATUSES,
  readRange,
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
 * статуса меняет эффективное списание (списывают только план / в работе; архив-
 * выработан и отмена — нет), поэтому нельзя пересекаться с приёмом рецепта и
 * изменением выработки. Need пишем только для списывающих статусов; для
 * архива/отмены — удаляем (потребности больше нет).
 */
async function transitionRecipe(uid: string, status: string): Promise<{ found: boolean }> {
  return withStockMutation(async () => {
    const found = await setRecipeStatus(uid, status);
    if (!found) return { found };
    await deleteNeedByRecipe(uid);
    if (STOCK_CONSUMING_STATUSES.has(status)) {
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
 *   plan    → «план»    (сырьё зарезервировано/списано);
 *   archive → «архив»   (выработан — НЕ списывается: после выработки грузится
 *                        новый остаток склада, расход уже в нём учтён);
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

/**
 * Частичная выработка: архивация рецепта с указанием выработанного количества.
 * { produced_tons: number }.
 *
 * Логика:
 * 1. Уменьшаем текущий рецепт до produced_tons (пересчитываем RecipeLines)
 * 2. Архивируем текущий рецепт
 * 3. Если есть остаток (batch_t - produced_tons > 0) — создаём НОВЫЙ рецепт
 *    на оставшееся количество с тем же составом, статус "план"
 * 4. Need пересчитывается автоматически
 */
router.post("/:uid/partial-archive", async (req: Request, res: Response) => {
  const produced = parseFloat(String(req.body?.produced_tons ?? "").replace(",", "."));
  if (!Number.isFinite(produced) || produced <= 0) {
    return res.status(400).json({ error: "Укажите выработанное количество больше 0" });
  }
  try {
    const result = await withStockMutation(async () => {
      // 1. Получаем данные рецепта
      const recipes = await getRecipesList();
      const rec = recipes.find(r => r.recipe_uid === req.params.uid);
      if (!rec) return { kind: "notFound" as const };
      if (rec.status === RECIPE_STATUS.CANCELLED || rec.status === RECIPE_STATUS.ARCHIVED) {
        return { kind: "badStatus" as const, status: rec.status };
      }

      const originalTons = rec.batch_t || 1;
      if (produced >= originalTons) {
        // Полная выработка — просто архивируем
        const { found } = await transitionRecipe(req.params.uid, RECIPE_STATUS.ARCHIVED);
        return { kind: "fullArchive" as const, found };
      }

      // 2. Частичная выработка: пересчитываем RecipeLines пропорционально
      const factor = produced / originalTons;
      const lines = await getRecipeLines(req.params.uid);
      const producedLines = lines.map(l => ({
        ...l,
        consumption_kg: l.consumption_kg ? l.consumption_kg * factor : l.consumption_kg,
      }));

      // 3. Удаляем старые Need, записываем Need для выработанного количества
      await deleteNeedByRecipe(req.params.uid);
      const needLines = producedLines
        .filter(l => l.raw_uid && l.match_status === "matched" && (l.consumption_kg || 0) > 0)
        .map(l => ({ raw_uid: l.raw_uid as string, net_qty: l.consumption_kg as number }));
      if (needLines.length) await writeNeedFromRecipe(req.params.uid, needLines);

      // 4. Архивируем текущий рецепт с уменьшенным batch_t
      await setRecipeStatus(req.params.uid, RECIPE_STATUS.ARCHIVED);
      // Обновляем batch_t и RecipeLines в архивном рецепте
      const { writeRange } = await import("../services/sheetsService");
      const allRecipes = await readRange("Recipes", "A2:M5000");
      for (let i = 0; i < allRecipes.length; i++) {
        if (String(allRecipes[i][0]) === req.params.uid) {
          await writeRange("Recipes", `G${i + 2}:G${i + 2}`, [[produced]]);
          await writeRange("Recipes", `M${i + 2}:M${i + 2}`, [[produced * 1000]]);
          break;
        }
      }
      // Обновляем RecipeLines архивного рецепта
      const allLines = await readRange("RecipeLines", "A2:L5000");
      for (let i = 0; i < allLines.length; i++) {
        if (String(allLines[i][1]) === req.params.uid) {
          const pl = producedLines.find(p => p.raw_uid === String(allLines[i][2]));
          if (pl) {
            allLines[i][7] = pl.consumption_kg || 0;
          }
        }
      }
      await writeRange("RecipeLines", `A2:L${allLines.length + 1}`, allLines);

      // 5. Если есть остаток — создаём новый рецепт
      const remaining = originalTons - produced;
      let newRecipeUid: string | null = null;
      if (remaining > 0.001) {
        const { writeRecipe, writeRecipeLines } = await import("../services/sheetsService");
        newRecipeUid = await writeRecipe({
          code: rec.code,
          full_name: rec.full_name,
          premix_name: rec.premix_name || rec.full_name,
          date: new Date().toISOString().slice(0, 10),
          concentration: 0,
          batch_t: remaining,
          customer: rec.customer || "",
          period: new Date().toISOString().slice(0, 7),
          quarter: `${Math.ceil((new Date().getMonth() + 1) / 3)}_квартал`,
          file_name: `остаток из ${rec.recipe_uid}`,
          base_batch_kg: remaining * 1000,
        });

        // Копируем RecipeLines с оставшимся количеством
        const remainingLines = lines.map(l => ({
          raw_uid: l.raw_uid || "",
          name_from_recipe: l.name_from_recipe || "",
          activity: l.activity || "",
          input_pct: l.input_pct || 0,
          norm_g_per_t: l.norm_g_per_t || 0,
          consumption_kg: l.consumption_kg ? l.consumption_kg * (1 - factor) : 0,
          match_status: l.match_status || "",
        }));
        await writeRecipeLines(newRecipeUid, remainingLines);

        // Записываем Need для нового рецепта (остаток)
        const remainingNeed = remainingLines
          .filter(l => l.raw_uid && l.match_status === "matched" && l.consumption_kg > 0)
          .map(l => ({ raw_uid: l.raw_uid, net_qty: l.consumption_kg }));
        if (remainingNeed.length) await writeNeedFromRecipe(newRecipeUid, remainingNeed);
      }

      return {
        kind: "partialArchive" as const,
        originalTons,
        producedTons: produced,
        remainingTons: remaining,
        newRecipeUid,
      };
    });

    if (result.kind === "notFound") return res.status(404).json({ error: "Рецепт не найден" });
    if (result.kind === "badStatus") {
      return res.status(400).json({ error: `Нельзя архивировать рецепт в статусе ${result.status}` });
    }
    if (result.kind === "fullArchive") {
      return res.json({ ok: true, mode: "full", message: "Рецепт полностью выработан и архивирован" });
    }
    res.json({
      ok: true,
      mode: "partial",
      originalTons: result.originalTons,
      producedTons: result.producedTons,
      remainingTons: result.remainingTons,
      newRecipeUid: result.newRecipeUid,
      message: `Выработано ${result.producedTons} т. Остаток ${result.remainingTons} т создан как новый рецепт ${result.newRecipeUid}`,
    });
  } catch (err: any) {
    console.error("[recipes/partial-archive]", err);
    res.status(500).json({ error: err.message });
  }
});
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


// ─── Удаление рецептов ──────────────────────────────────────────────────

router.delete("/:uid", async (req: Request, res: Response) => {
  try {
    const removed = await deleteRecipe(req.params.uid);
    res.json({ ok: true, removed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bulk/delete", async (req: Request, res: Response) => {
  const { uids } = req.body;
  if (!Array.isArray(uids) || !uids.length) return res.status(400).json({ error: "uids[] обязателен" });
  try {
    const done = await deleteRecipesBulk(uids);
    res.json({ ok: true, done });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
