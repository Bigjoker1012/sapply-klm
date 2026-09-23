/**
 * Сид справочников из JSON-снимка Google Sheets.
 *
 * Используется двумя путями:
 *   1) CLI: `npm run seed:catalog` (этот файл как entrypoint).
 *   2) bootstrap при старте сервера — вызывает `runCatalogSeed()`, чтобы прод
 *      поднялся с наполненным каталогом.
 *
 * Предусловие: схема БД уже создана (drizzle-kit push в dev / publish-diff в
 * prod). Сам сид DDL не выполняет.
 *
 * Идемпотентно: `onConflictDoNothing` по уникальным индексам
 *   - `sku_code_unique` (sku.code)
 *   - `supplier_name_unique` (supplier.name)
 * Повторный запуск ничего не дублирует и не затирает отредактированные
 * через UI записи.
 *
 * Файл `server/src/db/seed-data/sku-catalog.json` — снимок листа Syryo
 * (полоцкий КХП), коммитится в репо: сид работает без доступа к Google Sheets,
 * прод redeploy не зависит от OAuth-токена.
 */
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { sku, supplier } from "../db/schema";

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
export async function runCatalogSeed(): Promise<CatalogSeedResult> {
  const seedPath = resolveSeedPath();
  const items: SkuSeed[] = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  let inserted = 0;
  let skipped = 0;
  let supplierId = 0;

  await db.transaction(async (tx) => {
    // Плейсхолдер-поставщик. В Sheets отдельного списка поставщиков нет.
    // UNIQUE на supplier.name гарантирует отсутствие дублей даже при
    // параллельном сиде.
    await tx
      .insert(supplier)
      .values({ name: PLACEHOLDER_SUPPLIER, active: true } as any)
      .onConflictDoNothing();
    const [sup] = await tx
      .select({ id: supplier.id })
      .from(supplier)
      .where(eq(supplier.name, PLACEHOLDER_SUPPLIER));
    if (!sup) throw new Error("Не удалось получить id плейсхолдер-поставщика");
    supplierId = sup.id;

    const values = items.map((s) => {
      // reorderPoint = средний месячный расход × коэф. (legacy-семантика
      // «Коэф. порога закупки»). minStock = половина reorderPoint —
      // эвристика, технолог поправит через UI.
      const reorderPoint = s.avgMonthlyUsageKg * s.reorderThresholdFactor;
      const minStock = reorderPoint * 0.5;
      return {
        code: s.code,
        name: s.name,
        category: s.category,
        unit: s.unit,
        defaultSupplierId: supplierId,
        shelfLifeDays: null,
        minStockKg: minStock || null,
        reorderPointKg: reorderPoint || null,
        active: s.active,
      };
    });

    if (values.length) {
      // onConflictDoNothing + returning: возвращаются только реально вставленные
      // строки (конфликтнувшие по sku.code пропускаются).
      const ins = await tx
        .insert(sku)
        .values(values as any)
        .onConflictDoNothing()
        .returning({ id: sku.id });
      inserted = ins.length;
      skipped = items.length - inserted;
    }
  });

  return { inserted, skipped, supplierId };
}

// CLI-entrypoint: запускаем только если файл вызван напрямую, а не импортирован.
if (require.main === module) {
  runCatalogSeed()
    .then((r) => {
      console.log(
        `[seed:catalog] supplier placeholder id=${r.supplierId}, sku: inserted ${r.inserted}, skipped ${r.skipped} (уже были)`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[seed:catalog] ошибка:", err);
      process.exit(1);
    });
}
