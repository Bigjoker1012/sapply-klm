---
name: Recipe lifecycle + live stock model (Sheets)
description: 3 recipe statuses, what each does to stock, the live "Остатки" formula, and the upload sufficiency gate.
---
Recipes are stored in Google Sheets (Recipes col L = status; RecipeLines col H = consumption_kg, col C = raw_uid). Three statuses (RECIPE_STATUS in sheetsService):
- «в работе» (IN_WORK) — raw materials are списаны (subtracted from stock).
- «отменён» (CANCELLED) — returns stock (NOT subtracted).
- «удалён» (DELETED) — archive; stock STAYS consumed (still subtracted).
Legacy «активен» = treat as «в работе» (see STOCK_CONSUMING_STATUSES, which = {в работе, удалён, активен}).

**Live stock** (`getLiveStock`, GET /api/stock/live) = latest PlantStock snapshot + latest LipStock snapshot − consumption of recipes whose status ∈ STOCK_CONSUMING_STATUSES, grouped by raw_uid. Inbound (товары в пути) is NOT included. Only RecipeLines rows with a raw_uid count (plant/unmatched rows can't be списаны).

**Upload sufficiency gate** (upload.ts /recipe): build all lines in memory, aggregate required-per-raw_uid for matched rows, compare to (plant+lip − consumed). If short → HTTP 409 `{error, shortages:[{raw_uid,name,required,available}]}` and write NOTHING (recipe not admitted). The whole check-then-write critical section runs under an in-process mutex `withRecipeAdmissionLock` — deploy is single-instance (vm), so this fully prevents two concurrent uploads double-spending the same stock. Write recipe lines BEFORE releasing the lock so the next upload sees the списание.

**Lifecycle endpoints** (recipes.ts, Sheets-backed, NOT Postgres): GET /, GET /:uid/lines, POST /:uid/cancel, POST /:uid/archive, POST /bulk {uids,action}. `transitionRecipe` deletes Need FIRST, then sets status — so a failed status write leaves a retryable in-work recipe rather than a "done" recipe with stale Need (no Sheets transactions).

**Need (procurement plan)** is kept SEPARATE from live stock: cancel/archive remove the recipe's Need rows, but Need is its own purchase plan, not the остатки view.

**Tons (выработка)**: entered at upload (client field → batchTons). consumption_kg = norm_per_t × tons; empty → falls back to recipe header batch then 1 т. See recipe-vyrabotka-scaling.md for the per-ton norm math.
