import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { listDocuments, getDocument, decodeFileName, deleteDocument } from "../services/documentArchive";
import { deleteNeedByRecipe } from "../services/sheetsService";
import { requireAuth } from "../auth/middleware";

const router = Router();

// Доступ только для авторизованных (как dashboard/recipes). Сейчас авторизация
// отключена глобально (AUTH_DISABLED) — middleware пропускает всех; останется
// защитой архива оригиналов, когда вход вернут.
router.use(requireAuth);

// ─── Архив прикреплённых документов ──────────────────────────────────────────

/** Список документов по типам: действующий + архив (без содержимого файлов). */
router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await listDocuments());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Скачивание конкретного документа из архива. */
router.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Некорректный id" });

    const doc = await getDocument(id);
    if (!doc) return res.status(404).json({ error: "Документ не найден" });

    const buffer = Buffer.from(doc.fileData, "base64");
    const encodedName = encodeURIComponent(decodeFileName(doc.fileName));
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    );
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Удаление документа из архива (без возможности восстановления). Для
 * документов-рецептов это ещё и «откат рецепта»: снимаем его потребность из
 * листа Need, чтобы количества вернулись в доступный остаток.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Некорректный id" });

    // Читаем тип и привязанный recipe_uid до удаления (raw SQL — типизированный
    // select drizzle не «видит» колонку recipe_uid под нашим билдом).
    const meta = (await db.execute(sql`
      SELECT doc_type, recipe_uid FROM document_archive WHERE id = ${id}
    `)).rows[0] as { doc_type: string; recipe_uid: string | null } | undefined;
    if (!meta) return res.status(404).json({ error: "Документ не найден" });

    // Откат рецепта: СНАЧАЛА снимаем потребность из листа Need, и только потом
    // удаляем сам документ. Иначе при сбое Sheets документ исчез бы, а
    // потребность осталась «висеть» без возможности повторить откат (по id уже
    // 404). При ошибке здесь — пробрасываем, документ остаётся, можно повторить.
    let needRemoved = 0;
    if (meta.doc_type === "recipe" && meta.recipe_uid) {
      needRemoved = await deleteNeedByRecipe(meta.recipe_uid);
    }

    const ok = await deleteDocument(id);
    if (!ok) return res.status(404).json({ error: "Документ не найден" });

    res.json({ ok: true, needRemoved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
