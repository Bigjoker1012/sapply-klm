import { pool } from '../index';

function normalize(str: string): string {
  return str.toLowerCase()
    .replace(/[^а-яёa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function findRawMaterialBySynonym(synonym: string): Promise<number | null> {
  const normalized = normalize(synonym);
  if (!normalized) return null;

  // 1. Точное совпадение с синонимом
  const syn = await pool.query(
    `SELECT ms.raw_material_id FROM material_synonyms ms
     WHERE lower(ms.synonym) = $1 LIMIT 1`,
    [normalized]
  );
  if (syn.rows.length) return syn.rows[0].raw_material_id;

  // 2. Точное совпадение с именем сырья
  const exact = await pool.query(
    `SELECT id FROM raw_materials WHERE lower(name) = $1 LIMIT 1`,
    [normalized]
  );
  if (exact.rows.length) return exact.rows[0].id;

  // 3. Частичное совпадение (contains)
  const partial = await pool.query(
    `SELECT id FROM raw_materials
     WHERE lower(name) LIKE $1 OR $2 LIKE '%' || lower(name) || '%'
     LIMIT 1`,
    [`%${normalized}%`, normalized]
  );
  if (partial.rows.length) return partial.rows[0].id;

  return null;
}

export async function addToUnmatchedQueue(
  originalText: string,
  sourceType: string,
  fileName: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO unmatched_queue (original_text, source_type, file_name)
       VALUES ($1,$2,$3)
       ON CONFLICT (original_text) DO NOTHING`,
      [originalText, sourceType, fileName]
    );
  } catch (_) {}
}

export async function addSynonym(rawMaterialId: number, synonym: string, source: string) {
  await pool.query(
    `INSERT INTO material_synonyms (raw_material_id, synonym, source)
     VALUES ($1,$2,$3) ON CONFLICT (raw_material_id, synonym) DO NOTHING`,
    [rawMaterialId, synonym, source]
  );
}
