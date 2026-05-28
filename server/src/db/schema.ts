/**
 * Supply KLM — схема БД (Drizzle ORM + SQLite)
 *
 * Соглашения:
 * - Английские snake_case имена в БД. Русские названия — в JSDoc-комментариях.
 *   В IDE при наведении мышкой на любое поле сразу видна расшифровка.
 * - Даты храним как ISO-строки (`YYYY-MM-DD`) или ISO-timestamp (`YYYY-MM-DDTHH:mm:ssZ`).
 *   SQLite не имеет native DATE/TIMESTAMP, текст — самый совместимый вариант.
 * - Денежные суммы и количества — `real` (double). Для премиксного учёта точности
 *   double хватает с большим запасом (~15 значащих цифр).
 * - Все статусы и enum-поля — текстовые литералы через `text({ enum: [...] })`.
 * - Каскадных удалений нет: историю не теряем. Деактивация через `active: false`
 *   или `status: 'archived' / 'cancelled'`.
 *
 * См. /docs/schema.md — там же глоссарий и обоснование решений.
 */

import { sqliteTable, integer, text, real, primaryKey, uniqueIndex, index, check, foreignKey } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

/**
 * ISO-8601 UTC timestamp с миллисекундами ("2026-05-28T14:32:01.123Z").
 * SQLite-овский CURRENT_TIMESTAMP даёт "YYYY-MM-DD HH:MM:SS" без T/Z —
 * парсеры JS на нём ломаются. Используем единый формат везде.
 */
const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ============================================================================
// 0. Организация (юрлицо / завод верхнего уровня)
// ============================================================================

/** Организация (юрлицо). Один завод = одна организация. */
export const organization = sqliteTable("organization", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Код (KHP_POLOTSK, KHP_GOMEL) */
  code: text("code").notNull().unique(),
  /** Название («Полоцкий КХП») */
  name: text("name").notNull(),
  /** ИНН/УНП */
  inn: text("inn"),
  /** Активна (false = архивная) */
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(nowIso),
});

// ============================================================================
// 1. Справочники
// ============================================================================

/** Склад (Полоцк, Липковская, …) */
export const warehouse = sqliteTable("warehouse", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Организация-владелец */
  organizationId: integer("organization_id").notNull().references(() => organization.id),
  /** Код (POLOTSK, LIPKOV) */
  code: text("code").notNull().unique(),
  /** Название («Полоцкий КХП», «Липковская») */
  name: text("name").notNull(),
  /** Основной (где происходит производство) */
  isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Поставщик (Адиссео, БАСФ, Эвоник…) */
export const supplier = sqliteTable("supplier", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Название */
  name: text("name").notNull(),
  /** Страна */
  country: text("country"),
  /** ИНН/УНП */
  inn: text("inn"),
  /** Контакты одной строкой (телефон, email, ФИО менеджера) */
  contact: text("contact"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Категория сырья */
export const skuCategory = ["amino_acid", "vitamin", "microelement", "filler", "antioxidant", "other"] as const;
export type SkuCategory = typeof skuCategory[number];

/** Сырьё (мастер-каталог) */
export const sku = sqliteTable("sku", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Внутренний код («AA-LYS-985») */
  code: text("code").notNull().unique(),
  /** Название («Лизин монохлоргидрат 98.5%») */
  name: text("name").notNull(),
  /** Категория (аминокислоты / витамины / микроэлементы / наполнители / антиоксиданты / прочее) */
  category: text("category", { enum: skuCategory }).notNull(),
  /** Единица измерения (по умолчанию "кг") */
  unit: text("unit").notNull().default("кг"),
  /** Предпочтительный поставщик */
  defaultSupplierId: integer("default_supplier_id").references(() => supplier.id),
  /** Срок годности по умолчанию (дни) */
  shelfLifeDays: integer("shelf_life_days"),
  /** Страховой запас, кг (порог для статуса «Срочно») */
  minStockKg: real("min_stock_kg"),
  /** Точка перезаказа, кг (порог для статуса «К закупке») */
  reorderPointKg: real("reorder_point_kg"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Альтернативное название сырья (как его пишут в 1С / PDF / Excel — для матчинга загрузок) */
export const skuAlias = sqliteTable("sku_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Вариант написания */
  alias: text("alias").notNull(),
  /** Источник (`1c` / `pdf_recipe` / `manual`) */
  source: text("source", { enum: ["1c", "pdf_recipe", "manual"] }).notNull(),
}, (t) => ({
  aliasIdx: uniqueIndex("sku_alias_lower_unique").on(sql`lower(${t.alias})`),
}));

// ============================================================================
// 2. Складской учёт (immutable batch model)
// ============================================================================

/**
 * Партия сырья (LOT) — атомарная единица учёта.
 * Никогда не меняется в количестве напрямую — только через `stockMovement`.
 * `currentQtyKg` — денормализованная сумма движений, пересчитывается сервисом.
 */
export const batch = sqliteTable("batch", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Склад */
  warehouseId: integer("warehouse_id").notNull().references(() => warehouse.id),
  /** № партии от поставщика */
  lotNo: text("lot_no"),
  /** Поставщик (nullable — для исторических остатков без атрибуции) */
  supplierId: integer("supplier_id").references(() => supplier.id),
  /** Дата производства (YYYY-MM-DD) */
  manufactureDate: text("manufacture_date"),
  /** Срок годности до (YYYY-MM-DD) */
  expiryDate: text("expiry_date"),
  /** Пришло (исходное кол-во), кг */
  initialQtyKg: real("initial_qty_kg").notNull(),
  /** Текущий остаток, кг (derived из движений) */
  currentQtyKg: real("current_qty_kg").notNull(),
  /** Цена за кг */
  unitPrice: real("unit_price"),
  /** Валюта (BYN / RUB / USD / EUR) */
  currency: text("currency"),
  /** № сертификата качества */
  certificateNo: text("certificate_no"),
  /** Принято на склад (ISO timestamp) */
  receivedAt: text("received_at").notNull().default(nowIso),
  /** Статус партии (active / quarantine / written_off) */
  status: text("status", { enum: ["active", "quarantine", "written_off"] }).notNull().default("active"),
}, (t) => ({
  // Партии с известным lot_no — глобально уникальны в рамках sku+склада.
  // Партии без lot_no (исторические остатки) — допускают несколько строк.
  uniqueLot: uniqueIndex("batch_sku_lot_wh_unique")
    .on(t.skuId, t.lotNo, t.warehouseId)
    .where(sql`${t.lotNo} IS NOT NULL`),
  byExpiry: index("batch_expiry_idx").on(t.expiryDate),
  byCurrent: index("batch_current_idx").on(t.skuId, t.warehouseId, t.status),
  // Композитный ключ (id, sku_id, warehouse_id) — нужен чтобы из transfer_batch
  // делать FK, гарантирующий совпадение sku/склада с переброской.
  identityIdx: uniqueIndex("batch_identity_unique").on(t.id, t.skuId, t.warehouseId),
  // Инвентарные инварианты
  qtyNonNeg: check("batch_qty_nonneg", sql`${t.initialQtyKg} >= 0 AND ${t.currentQtyKg} >= 0`),
  qtyNotOver: check("batch_qty_le_initial", sql`${t.currentQtyKg} <= ${t.initialQtyKg}`),
  pricePos: check("batch_price_nonneg", sql`${t.unitPrice} IS NULL OR ${t.unitPrice} >= 0`),
}));

/** Тип движения по партии */
export const movementKind = [
  "receipt",       // приход на склад
  "consumption",   // расход в производство
  "transfer_out",  // ушло переброской
  "transfer_in",   // пришло переброской
  "writeoff",      // списание
  "correction",    // ручная корректировка (инвентаризация)
] as const;

/** Движение по партии (приход / расход / переброска / списание / корректировка) */
export const stockMovement = sqliteTable("stock_movement", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Партия */
  batchId: integer("batch_id").notNull().references(() => batch.id),
  /** Тип движения */
  kind: text("kind", { enum: movementKind }).notNull(),
  /** Количество, кг (всегда положительное; знак выводится из kind) */
  qtyKg: real("qty_kg").notNull(),
  /** Тип связанной сущности (production_plan / transfer / upload_job / manual) */
  refType: text("ref_type"),
  /** ID связанной сущности */
  refId: integer("ref_id"),
  /** Когда произошло (ISO timestamp) */
  occurredAt: text("occurred_at").notNull().default(nowIso),
  /** Кто сделал */
  actorId: integer("actor_id").references(() => user.id),
  comment: text("comment"),
}, (t) => ({
  byBatch: index("movement_batch_idx").on(t.batchId, t.occurredAt),
  byRef: index("movement_ref_idx").on(t.refType, t.refId),
  qtyPos: check("movement_qty_pos", sql`${t.qtyKg} > 0`),
}));

/** Снимок остатков на дату (для аудита и отката загрузок) */
export const stockSnapshot = sqliteTable("stock_snapshot", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Склад */
  warehouseId: integer("warehouse_id").notNull().references(() => warehouse.id),
  /** Дата снимка (YYYY-MM-DD) */
  snapshotDate: text("snapshot_date").notNull(),
  /** Источник (`upload_job:42`, `manual`) */
  source: text("source").notNull(),
  /** Сырой остаток как JSON: [{sku_id, qty_kg}, ...] */
  payloadJson: text("payload_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
});

// ============================================================================
// 3. Рецепты и план производства
// ============================================================================

/** Целевое животное для рецепта */
export const targetAnimal = ["pigs", "poultry", "cattle", "other"] as const;

/** Рецепт премикса (версионированный) */
export const recipe = sqliteTable("recipe", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Шифр («П-12», «Р-СВ-15») */
  code: text("code").notNull(),
  /** Название («Премикс свиньи откорм 1%») */
  name: text("name").notNull(),
  /** Целевое животное (свиньи / птица / КРС / прочее) */
  targetAnimal: text("target_animal", { enum: targetAnimal }).notNull(),
  /** Версия (инкремент при изменении состава) */
  version: integer("version").notNull().default(1),
  /** Действует с (YYYY-MM-DD) */
  activeFrom: text("active_from"),
  /** Действует по (YYYY-MM-DD), null = бессрочно */
  activeTo: text("active_to"),
  /** Статус (draft / active / archived) */
  status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
  /** Источник: задание загрузки PDF (если из PDF) */
  sourcePdfId: integer("source_pdf_id").references((): any => uploadJob.id),
  /** Создал */
  createdBy: integer("created_by").references(() => user.id),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  uniqueCodeVersion: uniqueIndex("recipe_code_version_unique").on(t.code, t.version),
  byActive: index("recipe_active_lookup_idx").on(t.code, t.status, t.activeFrom, t.activeTo),
}));

/** Состав рецепта — какое сырьё и в какой дозировке */
export const recipeItem = sqliteTable("recipe_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Рецепт */
  recipeId: integer("recipe_id").notNull().references(() => recipe.id),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Дозировка, кг на тонну премикса */
  doseKgPerT: real("dose_kg_per_t").notNull(),
  /** Порядок отображения */
  sortOrder: integer("sort_order").notNull().default(0),
  note: text("note"),
}, (t) => ({
  uniqueRecipeSku: uniqueIndex("recipe_item_recipe_sku_unique").on(t.recipeId, t.skuId),
  dosePos: check("recipe_item_dose_pos", sql`${t.doseKgPerT} > 0`),
}));

/** План производства (что и когда смешиваем) */
export const productionPlan = sqliteTable("production_plan", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Рецепт */
  recipeId: integer("recipe_id").notNull().references(() => recipe.id),
  /** Количество, т (плановое) */
  qtyT: real("qty_t").notNull(),
  /** Плановая дата (YYYY-MM-DD) */
  plannedDate: text("planned_date").notNull(),
  /** Склад (где производим) */
  warehouseId: integer("warehouse_id").notNull().references(() => warehouse.id),
  /** Статус (planned / in_progress / done / cancelled) */
  status: text("status", { enum: ["planned", "in_progress", "done", "cancelled"] }).notNull().default("planned"),
  /** Фактически произведено, т */
  actualQtyT: real("actual_qty_t"),
  /** Когда завершено (ISO timestamp) */
  doneAt: text("done_at"),
}, (t) => ({
  byDate: index("plan_date_idx").on(t.plannedDate, t.status),
  byWh: index("plan_wh_date_idx").on(t.warehouseId, t.plannedDate, t.status),
  qtyPos: check("plan_qty_pos", sql`${t.qtyT} > 0`),
  actualPos: check("plan_actual_nonneg", sql`${t.actualQtyT} IS NULL OR ${t.actualQtyT} >= 0`),
}));

// ============================================================================
// 4. Снабжение
// ============================================================================

/** Поступление в пути (сырьё, которое едет к нам) */
export const inTransit = sqliteTable("in_transit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Поставщик */
  supplierId: integer("supplier_id").notNull().references(() => supplier.id),
  /** Куда придёт */
  warehouseId: integer("warehouse_id").notNull().references(() => warehouse.id),
  /** Количество, кг */
  qtyKg: real("qty_kg").notNull(),
  /** Цена за кг */
  unitPrice: real("unit_price"),
  /** Валюта */
  currency: text("currency"),
  /** Ожидаемая дата поступления (YYYY-MM-DD) */
  etaDate: text("eta_date"),
  /** Способ доставки (truck / rail / sea / air) */
  transport: text("transport", { enum: ["truck", "rail", "sea", "air"] }),
  /** Статус (at_supplier / in_transit / customs / received) */
  status: text("status", { enum: ["at_supplier", "in_transit", "customs", "received"] }).notNull().default("at_supplier"),
  /** № договора / заказа */
  poRef: text("po_ref"),
  /** При status='received' — связанная созданная партия */
  receivedBatchId: integer("received_batch_id").references(() => batch.id),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  byEta: index("in_transit_eta_idx").on(t.etaDate, t.status),
  byWh: index("in_transit_wh_status_eta_idx").on(t.warehouseId, t.status, t.etaDate),
  bySku: index("in_transit_sku_status_idx").on(t.skuId, t.status),
  qtyPos: check("in_transit_qty_pos", sql`${t.qtyKg} > 0`),
  pricePos: check("in_transit_price_nonneg", sql`${t.unitPrice} IS NULL OR ${t.unitPrice} >= 0`),
}));

/** Переброска между складами (Полоцк ↔ Липковская) */
export const transfer = sqliteTable("transfer", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Откуда */
  fromWarehouseId: integer("from_warehouse_id").notNull().references(() => warehouse.id),
  /** Куда */
  toWarehouseId: integer("to_warehouse_id").notNull().references(() => warehouse.id),
  /** Количество, кг */
  qtyKg: real("qty_kg").notNull(),
  /** Статус (planned / in_transit / received / cancelled) */
  status: text("status", { enum: ["planned", "in_transit", "received", "cancelled"] }).notNull().default("planned"),
  /** Плановая дата (YYYY-MM-DD) */
  plannedDate: text("planned_date"),
  /** Дата завершения (ISO timestamp) */
  completedAt: text("completed_at"),
  /** Создал */
  createdBy: integer("created_by").references(() => user.id),
  comment: text("comment"),
}, (t) => ({
  byFromStatus: index("transfer_from_status_idx").on(t.fromWarehouseId, t.status, t.plannedDate),
  byToStatus: index("transfer_to_status_idx").on(t.toWarehouseId, t.status, t.plannedDate),
  bySku: index("transfer_sku_status_idx").on(t.skuId, t.status),
  qtyPos: check("transfer_qty_pos", sql`${t.qtyKg} > 0`),
  diffWh: check("transfer_from_ne_to", sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`),
}));

/**
 * Связь переброски с конкретными партиями (LOT-ами).
 * Денормализуем `batchSkuId` / `batchWarehouseId` (= sku/склад партии) и
 * композитный FK на (batch.id, sku_id, warehouse_id) — это гарантирует,
 * что батч физически совпадает с тем, что указано в переброске.
 * Сервис обязан подставить sku/склад из batch при вставке; согласованность
 * с `transfer.sku_id` и `transfer.from_warehouse_id` проверяется триггером
 * (см. миграцию `0001_transfer_batch_guard.sql`).
 */
export const transferBatch = sqliteTable("transfer_batch", {
  /** Переброска */
  transferId: integer("transfer_id").notNull().references(() => transfer.id),
  /** Партия */
  batchId: integer("batch_id").notNull(),
  /** Сырьё партии (денормализовано для FK) */
  batchSkuId: integer("batch_sku_id").notNull().references(() => sku.id),
  /** Склад партии (= источник переброски) */
  batchWarehouseId: integer("batch_warehouse_id").notNull().references(() => warehouse.id),
  /** Количество из этой партии, кг */
  qtyKg: real("qty_kg").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.transferId, t.batchId] }),
  qtyPos: check("transfer_batch_qty_pos", sql`${t.qtyKg} > 0`),
  // Композитный FK на batch_identity_unique — батч обязан существовать
  // именно с этим sku и складом.
  batchIdentityFk: foreignKey({
    columns: [t.batchId, t.batchSkuId, t.batchWarehouseId],
    foreignColumns: [batch.id, batch.skuId, batch.warehouseId],
    name: "transfer_batch_identity_fk",
  }),
}));

/** Заказ поставщику (рождается из кнопки «Заказать N кг» на дашборде) */
export const purchaseOrder = sqliteTable("purchase_order", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Сырьё */
  skuId: integer("sku_id").notNull().references(() => sku.id),
  /** Поставщик */
  supplierId: integer("supplier_id").notNull().references(() => supplier.id),
  /** Количество, кг */
  qtyKg: real("qty_kg").notNull(),
  /** Цена за кг */
  unitPrice: real("unit_price"),
  /** Валюта */
  currency: text("currency"),
  /** Статус (draft / sent / confirmed / cancelled / fulfilled) */
  status: text("status", { enum: ["draft", "sent", "confirmed", "cancelled", "fulfilled"] }).notNull().default("draft"),
  /** Ожидаемая дата поступления (YYYY-MM-DD) */
  expectedEta: text("expected_eta"),
  /** Когда заказ «выехал» — связанное in_transit */
  inTransitId: integer("in_transit_id").references(() => inTransit.id),
  /** Создал */
  createdBy: integer("created_by").references(() => user.id),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  byStatus: index("po_status_eta_idx").on(t.status, t.expectedEta),
  bySupplier: index("po_supplier_status_idx").on(t.supplierId, t.status),
  bySku: index("po_sku_status_idx").on(t.skuId, t.status),
  qtyPos: check("po_qty_pos", sql`${t.qtyKg} > 0`),
  pricePos: check("po_price_nonneg", sql`${t.unitPrice} IS NULL OR ${t.unitPrice} >= 0`),
}));

// ============================================================================
// 5. Загрузки и аудит
// ============================================================================

/** Тип загруженного файла */
export const uploadKind = [
  "stock_polotsk_xlsx",       // остатки Полоцк (Excel из 1С)
  "stock_lipkovskaya_xlsx",   // остатки Липковская (КД по партиям)
  "recipe_pdf",               // рецепт технолога (PDF)
  "in_transit_xlsx",          // поступления в пути (Excel)
] as const;

/** Загрузка файла (Excel / PDF) */
export const uploadJob = sqliteTable("upload_job", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Тип файла */
  kind: text("kind", { enum: uploadKind }).notNull(),
  /** Имя файла */
  filename: text("filename").notNull(),
  /** SHA-256 хеш файла (защита от повторной загрузки того же файла) */
  fileHash: text("file_hash").notNull(),
  /** Кто загрузил */
  uploadedBy: integer("uploaded_by").references(() => user.id),
  uploadedAt: text("uploaded_at").notNull().default(nowIso),
  /** Статус обработки (parsing / review / applied / rejected / failed) */
  status: text("status", { enum: ["parsing", "review", "applied", "rejected", "failed"] }).notNull().default("parsing"),
  /** Всего строк распарсено */
  rowsTotal: integer("rows_total").notNull().default(0),
  /** Сопоставлено с каталогом автоматически */
  rowsMatched: integer("rows_matched").notNull().default(0),
  /** Не сопоставлено (требует ручного review) */
  rowsUnmatched: integer("rows_unmatched").notNull().default(0),
  /** Когда применено (ISO timestamp) */
  appliedAt: text("applied_at"),
  /** Сообщение об ошибке (если failed) */
  error: text("error"),
}, (t) => ({
  uniqueHash: uniqueIndex("upload_job_hash_unique").on(t.fileHash),
}));

/** Сырая строка загрузки (до маппинга на справочник sku) */
export const uploadRow = sqliteTable("upload_row", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Задание загрузки */
  uploadJobId: integer("upload_job_id").notNull().references(() => uploadJob.id),
  /** Индекс строки в исходном файле */
  rowIndex: integer("row_index").notNull(),
  /** Имя листа Excel (для многолистовых файлов) */
  sheetName: text("sheet_name"),
  /** Сырая строка целиком (JSON) */
  rawPayload: text("raw_payload", { mode: "json" }).notNull(),
  /** Сопоставленное сырьё (если нашли) */
  matchedSkuId: integer("matched_sku_id").references(() => sku.id),
  /** Уверенность распознавания (0..1) */
  confidence: real("confidence"),
  /** Действие (auto_apply / manual_review / skip / rejected) */
  action: text("action", { enum: ["auto_apply", "manual_review", "skip", "rejected"] }).notNull().default("manual_review"),
  /** Кто проверил */
  reviewedBy: integer("reviewed_by").references(() => user.id),
  /** Когда проверено (ISO timestamp) */
  reviewedAt: text("reviewed_at"),
  /** Комментарий проверяющего */
  reviewNote: text("review_note"),
}, (t) => ({
  byJob: index("upload_row_job_idx").on(t.uploadJobId, t.action),
}));

/** Журнал событий — аудит каждой правки */
export const eventLog = sqliteTable("event_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Кто сделал */
  actorId: integer("actor_id").references(() => user.id),
  /** Действие (recipe.create, batch.writeoff, po.send, …) */
  action: text("action").notNull(),
  /** Тип сущности */
  entityType: text("entity_type").notNull(),
  /** ID сущности */
  entityId: integer("entity_id").notNull(),
  /** Состояние до */
  beforeJson: text("before_json", { mode: "json" }),
  /** Состояние после */
  afterJson: text("after_json", { mode: "json" }),
  /** IP клиента */
  ip: text("ip"),
  occurredAt: text("occurred_at").notNull().default(nowIso),
}, (t) => ({
  byEntity: index("event_log_entity_idx").on(t.entityType, t.entityId),
  byActor: index("event_log_actor_idx").on(t.actorId, t.occurredAt),
}));

// ============================================================================
// 6. Пользователи и сессии
// ============================================================================

/** Роль пользователя */
export const userRole = ["admin", "snabzhenets", "tehnolog", "viewer"] as const;
export type UserRole = typeof userRole[number];

/** Пользователь */
export const user = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Логин (email или короткий) */
  login: text("login").notNull().unique(),
  /** Хеш пароля (argon2id) */
  passwordHash: text("password_hash").notNull(),
  /** ФИО («Иванов А.С.») */
  name: text("name").notNull(),
  /** Роль */
  role: text("role", { enum: userRole }).notNull(),
  /** Привязка к организации (null для admin — видит все) */
  organizationId: integer("organization_id").references(() => organization.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Последний вход (ISO timestamp) */
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(nowIso),
});

/**
 * Сессия входа.
 * Безопасность: в БД храним SHA-256-хеш токена, а не сам токен.
 * При утечке дампа БД активные сессии нельзя будет переиспользовать.
 * Клиенту выдаётся сырой случайный токен (32 байта в base64url),
 * сервер при проверке хеширует поступивший токен и ищет по token_hash.
 */
export const session = sqliteTable("session", {
  /** SHA-256(token) в hex — НЕ сам токен */
  tokenHash: text("token_hash").primaryKey(),
  /** Пользователь */
  userId: integer("user_id").notNull().references(() => user.id),
  createdAt: text("created_at").notNull().default(nowIso),
  /** Истекает (ISO timestamp) */
  expiresAt: text("expires_at").notNull(),
  /** IP при создании */
  ip: text("ip"),
}, (t) => ({
  byUser: index("session_user_idx").on(t.userId),
  byExpiry: index("session_expiry_idx").on(t.expiresAt),
}));

// ============================================================================
// 7. Relations (для типобезопасных join-ов)
// ============================================================================

export const organizationRel = relations(organization, ({ many }) => ({
  warehouses: many(warehouse),
  users: many(user),
}));

export const warehouseRel = relations(warehouse, ({ one, many }) => ({
  organization: one(organization, { fields: [warehouse.organizationId], references: [organization.id] }),
  batches: many(batch),
  plans: many(productionPlan),
}));

export const skuRel = relations(sku, ({ one, many }) => ({
  defaultSupplier: one(supplier, { fields: [sku.defaultSupplierId], references: [supplier.id] }),
  aliases: many(skuAlias),
  batches: many(batch),
  recipeItems: many(recipeItem),
  inTransit: many(inTransit),
  purchaseOrders: many(purchaseOrder),
}));

export const batchRel = relations(batch, ({ one, many }) => ({
  sku: one(sku, { fields: [batch.skuId], references: [sku.id] }),
  warehouse: one(warehouse, { fields: [batch.warehouseId], references: [warehouse.id] }),
  supplier: one(supplier, { fields: [batch.supplierId], references: [supplier.id] }),
  movements: many(stockMovement),
  transferLinks: many(transferBatch),
}));

export const stockMovementRel = relations(stockMovement, ({ one }) => ({
  batch: one(batch, { fields: [stockMovement.batchId], references: [batch.id] }),
  actor: one(user, { fields: [stockMovement.actorId], references: [user.id] }),
}));

export const recipeRel = relations(recipe, ({ one, many }) => ({
  items: many(recipeItem),
  plans: many(productionPlan),
  sourcePdf: one(uploadJob, { fields: [recipe.sourcePdfId], references: [uploadJob.id] }),
  creator: one(user, { fields: [recipe.createdBy], references: [user.id] }),
}));

export const recipeItemRel = relations(recipeItem, ({ one }) => ({
  recipe: one(recipe, { fields: [recipeItem.recipeId], references: [recipe.id] }),
  sku: one(sku, { fields: [recipeItem.skuId], references: [sku.id] }),
}));

export const productionPlanRel = relations(productionPlan, ({ one }) => ({
  recipe: one(recipe, { fields: [productionPlan.recipeId], references: [recipe.id] }),
  warehouse: one(warehouse, { fields: [productionPlan.warehouseId], references: [warehouse.id] }),
}));

export const inTransitRel = relations(inTransit, ({ one }) => ({
  sku: one(sku, { fields: [inTransit.skuId], references: [sku.id] }),
  supplier: one(supplier, { fields: [inTransit.supplierId], references: [supplier.id] }),
  warehouse: one(warehouse, { fields: [inTransit.warehouseId], references: [warehouse.id] }),
  receivedBatch: one(batch, { fields: [inTransit.receivedBatchId], references: [batch.id] }),
}));

export const transferRel = relations(transfer, ({ one, many }) => ({
  sku: one(sku, { fields: [transfer.skuId], references: [sku.id] }),
  fromWarehouse: one(warehouse, { fields: [transfer.fromWarehouseId], references: [warehouse.id] }),
  toWarehouse: one(warehouse, { fields: [transfer.toWarehouseId], references: [warehouse.id] }),
  batches: many(transferBatch),
  creator: one(user, { fields: [transfer.createdBy], references: [user.id] }),
}));

export const transferBatchRel = relations(transferBatch, ({ one }) => ({
  transfer: one(transfer, { fields: [transferBatch.transferId], references: [transfer.id] }),
  batch: one(batch, { fields: [transferBatch.batchId], references: [batch.id] }),
}));

export const purchaseOrderRel = relations(purchaseOrder, ({ one }) => ({
  sku: one(sku, { fields: [purchaseOrder.skuId], references: [sku.id] }),
  supplier: one(supplier, { fields: [purchaseOrder.supplierId], references: [supplier.id] }),
  inTransit: one(inTransit, { fields: [purchaseOrder.inTransitId], references: [inTransit.id] }),
  creator: one(user, { fields: [purchaseOrder.createdBy], references: [user.id] }),
}));

export const uploadJobRel = relations(uploadJob, ({ many, one }) => ({
  rows: many(uploadRow),
  uploader: one(user, { fields: [uploadJob.uploadedBy], references: [user.id] }),
}));

export const uploadRowRel = relations(uploadRow, ({ one }) => ({
  job: one(uploadJob, { fields: [uploadRow.uploadJobId], references: [uploadJob.id] }),
  matchedSku: one(sku, { fields: [uploadRow.matchedSkuId], references: [sku.id] }),
  reviewer: one(user, { fields: [uploadRow.reviewedBy], references: [user.id] }),
}));

export const userRel = relations(user, ({ one, many }) => ({
  organization: one(organization, { fields: [user.organizationId], references: [organization.id] }),
  sessions: many(session),
  events: many(eventLog),
}));

export const sessionRel = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const supplierRel = relations(supplier, ({ many }) => ({
  skus: many(sku),
  batches: many(batch),
  inTransit: many(inTransit),
  purchaseOrders: many(purchaseOrder),
}));

export const skuAliasRel = relations(skuAlias, ({ one }) => ({
  sku: one(sku, { fields: [skuAlias.skuId], references: [sku.id] }),
}));

// ============================================================================
// Удобные типы для приложения
// ============================================================================

export type Organization = typeof organization.$inferSelect;
export type Warehouse    = typeof warehouse.$inferSelect;
export type Supplier     = typeof supplier.$inferSelect;
export type Sku          = typeof sku.$inferSelect;
export type SkuAlias     = typeof skuAlias.$inferSelect;
export type Batch        = typeof batch.$inferSelect;
export type StockMovement= typeof stockMovement.$inferSelect;
export type StockSnapshot= typeof stockSnapshot.$inferSelect;
export type Recipe       = typeof recipe.$inferSelect;
export type RecipeItem   = typeof recipeItem.$inferSelect;
export type ProductionPlan = typeof productionPlan.$inferSelect;
export type InTransit    = typeof inTransit.$inferSelect;
export type Transfer     = typeof transfer.$inferSelect;
export type TransferBatch= typeof transferBatch.$inferSelect;
export type PurchaseOrder= typeof purchaseOrder.$inferSelect;
export type UploadJob    = typeof uploadJob.$inferSelect;
export type UploadRow    = typeof uploadRow.$inferSelect;
export type EventLog     = typeof eventLog.$inferSelect;
export type User         = typeof user.$inferSelect;
export type Session      = typeof session.$inferSelect;

export type NewOrganization  = typeof organization.$inferInsert;
export type NewWarehouse     = typeof warehouse.$inferInsert;
export type NewSupplier      = typeof supplier.$inferInsert;
export type NewSku           = typeof sku.$inferInsert;
export type NewBatch         = typeof batch.$inferInsert;
export type NewStockMovement = typeof stockMovement.$inferInsert;
export type NewRecipe        = typeof recipe.$inferInsert;
export type NewRecipeItem    = typeof recipeItem.$inferInsert;
export type NewProductionPlan= typeof productionPlan.$inferInsert;
export type NewInTransit     = typeof inTransit.$inferInsert;
export type NewTransfer      = typeof transfer.$inferInsert;
export type NewPurchaseOrder = typeof purchaseOrder.$inferInsert;
export type NewUploadJob     = typeof uploadJob.$inferInsert;
export type NewUploadRow     = typeof uploadRow.$inferInsert;
export type NewUser          = typeof user.$inferInsert;
