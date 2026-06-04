import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { documentArchive, DocumentType } from "../db/schema";

/** Загруженный файл (срез интерфейса multer-файла). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * multer отдаёт имя файла из multipart-формы как latin1, поэтому кириллица
 * приходит «кракозябрами». Перекодируем latin1→utf8. Если в строке нет байтов
 * выше 0x7F (только ASCII) — оставляем как есть.
 */
export function decodeFileName(name: string): string {
  try {
    if (!/[\u0080-\u00ff]/.test(name)) return name;
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("\ufffd") ? name : decoded;
  } catch {
    return name;
  }
}

/**
 * Сохраняет оригинал прикреплённого файла в архив. Возвращает id записи.
 * Ошибки логируются, но не пробрасываются — сбой архивации не должен ломать
 * саму загрузку данных (парсинг уже выполнен успешно).
 */
export async function saveDocument(docType: DocumentType, file: UploadedFile): Promise<number | null> {
  try {
    const [row] = await db
      .insert(documentArchive)
      .values({
        docType,
        fileName: decodeFileName(file.originalname),
        mimeType: file.mimetype || "application/octet-stream",
        fileData: file.buffer.toString("base64"),
        sizeBytes: file.buffer.length,
      })
      .returning({ id: documentArchive.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[documentArchive] не удалось сохранить файл в архив:", err);
    return null;
  }
}

/** Метаданные документа (без содержимого файла). */
export interface DocumentMeta {
  id: number;
  docType: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/**
 * Возвращает по каждому типу документа: действующий (последний по времени
 * закрепления) и весь архив (от новых к старым), без содержимого файлов.
 */
export async function listDocuments(): Promise<
  Record<DocumentType, { active: DocumentMeta | null; archive: DocumentMeta[] }>
> {
  const rows = await db
    .select({
      id: documentArchive.id,
      docType: documentArchive.docType,
      fileName: documentArchive.fileName,
      mimeType: documentArchive.mimeType,
      sizeBytes: documentArchive.sizeBytes,
      uploadedAt: documentArchive.uploadedAt,
    })
    .from(documentArchive)
    .orderBy(desc(documentArchive.uploadedAt), desc(documentArchive.id));

  const result: Record<string, { active: DocumentMeta | null; archive: DocumentMeta[] }> = {
    polotsk: { active: null, archive: [] },
    lipkovskaya: { active: null, archive: [] },
    kd: { active: null, archive: [] },
    recipe: { active: null, archive: [] },
  };

  for (const r of rows) {
    const bucket = result[r.docType];
    if (!bucket) continue;
    const meta = { ...r, fileName: decodeFileName(r.fileName) } as DocumentMeta;
    bucket.archive.push(meta);
    if (!bucket.active) bucket.active = meta;
  }

  return result as Record<DocumentType, { active: DocumentMeta | null; archive: DocumentMeta[] }>;
}

/** Полная запись документа с содержимым (для скачивания). */
export async function getDocument(id: number) {
  const [row] = await db
    .select()
    .from(documentArchive)
    .where(eq(documentArchive.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Удаляет документ из архива по id. Возвращает true, если запись была найдена и
 * удалена. Если удалить действующую (последнюю) версию, действующей автоматически
 * станет предыдущая по времени — listDocuments вычисляет active как самый свежий.
 */
export async function deleteDocument(id: number): Promise<boolean> {
  const deleted = await db
    .delete(documentArchive)
    .where(eq(documentArchive.id, id))
    .returning({ id: documentArchive.id });
  return deleted.length > 0;
}
