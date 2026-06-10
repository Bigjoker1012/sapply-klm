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

**Shared stock mutex** (`withStockMutation` in services/stockMutex.ts): ALL stock-mutating ops serialize through ONE in-process mutex — upload admission, tons edit, AND status transitions (cancel/archive/bulk). Deploy is single-instance (vm), so this fully prevents any two ops double-spending the same остаток. **Why one mutex, not per-route locks:** a status change (cancel returns stock) racing a tons-increase check reads stale availability. Any new endpoint that reads-then-writes stock must run inside it.

**Upload sufficiency gate** (upload.ts /recipe): build all lines in memory, aggregate required-per-raw_uid for matched rows, compare to (plant+lip − consumed). If short → HTTP 409 `{error, shortages:[{raw_uid,name,required,available}]}` and write NOTHING (recipe not admitted). Check-then-write runs under withStockMutation; write recipe lines before releasing so the next op sees the списание.

**Edit выработка of existing recipe** (POST /api/recipes/:uid/tons {tons}, recipes.ts → updateRecipeTons): only allowed for status ∈ STOCK_CONSUMING_STATUSES. Scales every RecipeLines.consumption_kg by factor=newTons/oldBatchT (proportional, NOT recomputed from rounded norm_g_per_t — avoids precision drift). Decrease auto-returns stock (live stock is dynamic, no explicit return). Increase: aggregate delta=consumption×(factor−1) **by raw_uid** (same material in 2+ lines must sum, else each passes alone) and compare to getLiveStock.available (already nets THIS recipe's current списание) → 409 shortages, write nothing. oldBatchT must be computed identically in route AND updateRecipeTons (batch_t col G, else base_batch_kg/1000, else 1т) or check/scale diverge. Write order inside updateRecipeTons: RecipeLines (stock source of truth) FIRST, then cosmetic Recipes G/M — limits partial-write damage on the shared sheet. Then deleteNeedByRecipe + writeNeedFromRecipe last.

**Lifecycle endpoints** (recipes.ts, Sheets-backed, NOT Postgres): GET /, GET /:uid/lines, POST /:uid/cancel, POST /:uid/archive, POST /:uid/tons, POST /bulk {uids,action}. `transitionRecipe` (under withStockMutation) deletes Need FIRST, then sets status — so a failed status write leaves a retryable in-work recipe rather than a "done" recipe with stale Need (no Sheets transactions).

**Need (procurement plan)** is kept SEPARATE from live stock: cancel/archive remove the recipe's Need rows, but Need is its own purchase plan, not the остатки view.

**Tons (выработка)**: entered at upload (client field → batchTons). consumption_kg = norm_per_t × tons; empty → falls back to recipe header batch then 1 т. See recipe-vyrabotka-scaling.md for the per-ton norm math.
