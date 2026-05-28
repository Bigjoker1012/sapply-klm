/**
 * Сид справочников из JSON-снимка Google Sheets.
 * Запуск: `npm run seed:catalog`
 *
 * Предусловие: миграции уже накатаны (вызывается через bootstrap при старте
 * сервера). Сам сидер миграции не катит — это убирает гонку с параллельным
 * `runMigrations` (раннер `__migrations` без межпроцессной блокировки). Если
 * сидите в чистом окружении — сначала `npm run db:migrate`, потом сид.
 *
 * Идемпотентно: `INSERT OR IGNORE` по уникальным индексам
 *   - `sku_code_unique` (sku.code)
 *   - `supplier_name_unique` (supplier.name, миграция 0003)
 * Повторный запуск ничего не дублирует и не затирает уже отредактированные
 * через UI записи.
 *
 * Файл `server/src/db/seed-data/sku-catalog.json` — это снимок листа Syryo
 * (полоцкий КХП), коммитится в репо: сидер должен работать без доступа к
 * Google Sheets, в проде redeploy не должен зависеть от OAuth-токена.
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
 * node из dist). tsc не копирует JSON в dist, поэтому относительные пути
 * через `__dirname` сломаются после сборки. Стратегия:
 *   1) сначала через `__dirname` (работает в dev/ts-node),
 *   2) затем через `process.cwd()` от корня репо (работает и из dist).
 * Первый существующий путь — выигрывает.
 */
function resolveSeedPath(): string {
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

async function main(): Promise<void> {
  const seedPath = resolveSeedPath();
  const items: SkuSeed[] = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  let inserted = 0;
  let skipped = 0;
  let supplierId: number;

  db.transaction((dbx) => {
    // Плейсхолдер-поставщик. В Sheets отдельного списка поставщиков нет,
    // в Inbound пусто. UNIQUE на supplier.name (миграция 0003) гарантирует
    // отсутствие дублей даже при параллельном сиде.
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

  console.log(
    `[seed:catalog] supplier placeholder id=${supplierId!}, sku: inserted ${inserted}, skipped ${skipped} (уже были)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:catalog] ошибка:", err);
    process.exit(1);
  });
