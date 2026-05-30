/**
 * Сид справочников из JSON-снимка Google Sheets.
 *
 * Используется двумя путями:
 *   1) CLI: `npm run seed:catalog` (этот файл как entrypoint).
 *   2) bootstrap при старте сервера — вызывает `runCatalogSeed()`, чтобы прод
 *      (где dev-БД из data/ не коммитится) поднялся с наполненным каталогом.
 *
 * Предусловие: миграции уже накатаны (bootstrap катит их перед сидом).
 * Сам сид миграции не катит — это убирает гонку с параллельным `runMigrations`.
 *
 * Идемпотентно: `INSERT OR IGNORE` по уникальным индексам
 *   - `sku_code_unique` (sku.code)
 *   - `supplier_name_unique` (supplier.name, миграция 0003)
 * Повторный запуск ничего не дублирует и не затирает отредактированные
 * через UI записи.
 *
 * Файл `server/src/db/seed-data/sku-catalog.json` — снимок листа Syryo
 * (полоцкий КХП), коммитится в репо: сид работает без доступа к Google Sheets,
 * прод redeploy не зависит от OAuth-токена.
 */
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

interface SkuSeed {
  code: string;
  name: string;
  category: "amino_acid" | "vitamin" | "microelement" | "filler" | "antioxidant" | "other";
  unit: string;
  active: boolean;
  avgMonthlyUsageKg: number;
  reorderThresholdFactor: number;
  leadTimeDays: number;
}

const PLACEHOLDER_SUPPLIER = "Не указан";

/**
 * Резолвим путь к JSON-снимку устойчиво к режиму запуска (ts-node из src vs
 * node из dist). tsc не копирует JSON в dist, поэтому `__dirname` после сборки
 * указывает в dist, где JSON нет. Стратегия:
 *   1) `__dirname` — работает в dev/ts-node;
 *   2) `process.cwd()` от корня репо — работает из dist (репо целиком есть
 *      в деплое, запуск всегда из корня).
 * Первый существующий путь — выигрывает.
 */
export function resolveSeedPath(): string {
  const candidates = [
    path.resolve(__dirname, "../db/seed-data/sku-catalog.json"),
    path.resolve(process.cwd(), "server/src/db/seed-data/sku-catalog.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `[seed:catalog] sku-catalog.json не найден. Искали: ${candidates.join(", ")}.\n` +
      `Запускайте из корня репо (npm run seed:catalog).`,
  );
}

export interface CatalogSeedResult {
  inserted: number;
  skipped: number;
  supplierId: number;
}

/** Залить каталог SKU + плейсхолдер-поставщика. Идемпотентно. */
export function runCatalogSeed(): CatalogSeedResult {
  const seedPath = resolveSeedPath();
  const items: SkuSeed[] = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  let inserted = 0;
  let skipped = 0;
  let supplierId = 0;

  db.transaction((dbx) => {
    // Плейсхолдер-поставщик. В Sheets отдельного списка поставщиков нет.
    // UNIQUE на supplier.name (миграция 0003) гарантирует отсутствие дублей
    // даже при параллельном сиде.
    dbx.run(sql`
      INSERT OR IGNORE INTO supplier (name, active)
      VALUES (${PLACEHOLDER_SUPPLIER}, 1)
    `);
    const row = dbx.get<{ id: number }>(
      sql`SELECT id FROM supplier WHERE name = ${PLACEHOLDER_SUPPLIER}`,
    );
    if (!row) throw new Error("Не удалось получить id плейсхолдер-поставщика");
    supplierId = row.id;

    for (const s of items) {
      // reorderPoint = средний месячный расход × коэф. (legacy-семантика
      // «Коэф. порога закупки»). minStock = половина reorderPoint —
      // эвристика, технолог поправит через UI.
      const reorderPoint = s.avgMonthlyUsageKg * s.reorderThresholdFactor;
      const minStock = reorderPoint * 0.5;

      const result = dbx.run(sql`
        INSERT OR IGNORE INTO sku (
          code, name, category, unit, default_supplier_id,
          shelf_life_days, min_stock_kg, reorder_point_kg, active
        ) VALUES (
          ${s.code}, ${s.name}, ${s.category}, ${s.unit}, ${supplierId},
          NULL, ${minStock || null}, ${reorderPoint || null}, ${s.active ? 1 : 0}
        )
      `);
      // better-sqlite3 возвращает changes: 0 если IGNORE сработал.
      if ((result as any).changes && (result as any).changes > 0) inserted += 1;
      else skipped += 1;
    }
  });

  return { inserted, skipped, supplierId };
}

// CLI-entrypoint: запускаем только если файл вызван напрямую, а не импортирован.
if (require.main === module) {
  try {
    const r = runCatalogSeed();
    console.log(
      `[seed:catalog] supplier placeholder id=${r.supplierId}, sku: inserted ${r.inserted}, skipped ${r.skipped} (уже были)`,
    );
    process.exit(0);
  } catch (err) {
    console.error("[seed:catalog] ошибка:", err);
    process.exit(1);
  }
}
