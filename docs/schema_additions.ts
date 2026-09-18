// ============================================================================
// SUPPLY KLM — ТЗ 3.2 Schema Additions
// Добавить в конец schema.ts (перед типами)
// ============================================================================

// --- Аналоги ---
/** Связи аналогов между SKU */
export const analog = pgTable("analog", {
  id: serial("id").primaryKey(),
  skuId: integer("sku_id").notNull().references(() => sku.id),
  analogSkuId: integer("analog_sku_id").notNull().references(() => sku.id),
  note: text("note"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  uniquePair: unique("analog_pair_unique").on(t.skuId, t.analogSkuId),
}));

// --- Исключения ---
/** Исключённые из распознавания позиции */
export const excludedItem = pgTable("excluded_item", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  sourceType: text("source_type"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  uniqueText: uniqueIndex("excluded_text_unique").on(sql`lower(${t.text})`),
}));

// --- Очередь нераспознанных ---
/** Очередь нераспознанных позиций */
export const unresolvedItem = pgTable("unresolved_item", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  sourceType: text("source_type").notNull(),
  fileName: text("file_name"),
  qty: doublePrecision("qty"),
  sourceWarehouse: text("source_warehouse"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedBy: integer("resolved_by").references(() => user.id),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  byResolved: index("unresolved_resolved_idx").on(t.resolved),
  bySource: index("unresolved_source_idx").on(t.sourceType),
}));

// --- Потребность ---
/** Потребность по рецептам */
export const need = pgTable("need", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipe.id),
  skuId: integer("sku_id").notNull().references(() => sku.id),
  period: text("period").notNull(),
  grossQty: doublePrecision("gross_qty").notNull(),
  adjustment: doublePrecision("adjustment").notNull().default(0),
  netQty: doublePrecision("net_qty").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => ({
  byRecipe: index("need_recipe_idx").on(t.recipeId, t.period),
  bySku: index("need_sku_idx").on(t.skuId, t.period),
  byPeriod: index("need_period_idx").on(t.period),
  qtyPos: check("need_qty_pos", sql`${t.grossQty} >= 0 AND ${t.netQty} >= 0`),
}));

// ============================================================================
// Relations для новых таблиц
// ============================================================================

export const analogRel = relations(analog, ({ one }) => ({
  sku: one(sku, { fields: [analog.skuId], references: [sku.id] }),
  analogSku: one(sku, { fields: [analog.analogSkuId], references: [sku.id] }),
}));

export const excludedItemRel = relations(excludedItem, () => ({}));

export const unresolvedItemRel = relations(unresolvedItem, ({ one }) => ({
  resolvedByUser: one(user, { fields: [unresolvedItem.resolvedBy], references: [user.id] }),
}));

export const needRel = relations(need, ({ one }) => ({
  recipe: one(recipe, { fields: [need.recipeId], references: [recipe.id] }),
  sku: one(sku, { fields: [need.skuId], references: [sku.id] }),
}));

// ============================================================================
// Типы для новых таблиц
// ============================================================================

export type Analog = typeof analog.$inferSelect;
export type ExcludedItem = typeof excludedItem.$inferSelect;
export type UnresolvedItem = typeof unresolvedItem.$inferSelect;
export type Need = typeof need.$inferSelect;

export type NewAnalog = typeof analog.$inferInsert;
export type NewExcludedItem = typeof excludedItem.$inferInsert;
export type NewUnresolvedItem = typeof unresolvedItem.$inferInsert;
export type NewNeed = typeof need.$inferInsert;
