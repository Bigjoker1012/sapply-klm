---
name: Recipe lifecycle «План→Факт» + deficit
description: How recipe statuses drive stock consumption and why shortage never blocks.
---

# Recipe lifecycle and stock consumption

Recipes are NOT deleted on completion — they carry a status. Stock consumption is
driven by status via `STOCK_CONSUMING_STATUSES` in `sheetsService.ts`:
**consuming = ТОЛЬКО «ожидающие» статусы «план» / «в работе» (легаси «активен»).**
ВЫРАБОТАННЫЕ рецепты («архив», легаси «удалён») и «отменён» НЕ списывают.
New recipes are written in status «план». Need rows: пишутся только для
списывающих статусов; для архива/отмены удаляются. `getNeedTotals` дополнительно
фильтрует по статусу на ЧТЕНИИ (join с Recipes), чтобы старые строки Need уже
выработанных рецептов не давали фантомную потребность без миграции.

**Why:** рабочий процесс «План→Факт»: план резервирует сырьё, а ПОСЛЕ выработки
склад загружает НОВЫЙ (уже уменьшенный) остаток — расход уже учтён в остатке,
поэтому списывать выработанный рецепт второй раз = ДВОЙНОЙ счёт (занижение
остатков). Отмена возвращает сырьё. Раньше архив ошибочно тоже списывал.

**How to apply:**
- Любой новый путь учёта расхода/потребности рецептов сверять по
  `STOCK_CONSUMING_STATUSES` (и «живое» потребление, и лист Need); архив = факт
  выработки, не резерв.
- Status transitions go through `POST /recipes/:uid/status {status: plan|archive|cancel}`
  (bulk: `{uids, status}`). There is NO `/cancel` or `/archive` route anymore.
- Shortage NEVER blocks. The old 409 admission gate (upload) and 409 shortage gate
  (tons update) were removed. Insufficient stock just drives `available` negative,
  which surfaces as a procurement signal — do not re-add a block. Only a *cancelled*
  recipe is rejected by the tons endpoint.
- `stockSignal(plant, lip, consumed)`: `critical` = plant+lip−consumed < 0 (срочно
  закупать); `transfer` = plant−consumed < 0 but total ≥ 0 (перевезти с Липковской);
  else `ok`. Returned by both `getLiveStock` and `getStockDeficit`.
- `getStockDeficit()` returns per-raw stock plus `contributors[]`
  (recipe_uid/name/status/qty) — the raw×recipe matrix the Дефицит tab renders.
- All stock-mutating flows (upload, status transition, tons) run under the shared
  stock mutex (`withStockMutation`).

**Один источник потребности для ВСЕХ экранов.** Потребность сырья считать ТОЛЬКО из
живого потребления рецептов (`getRecipeConsumptionByStatus(STOCK_CONSUMING_STATUSES)`,
читает RecipeLines напрямую), а НЕ из листа `Need`/`getNeedTotals`. Лист Need
пишется лишь при разборе/смене статуса и легко расходится с RecipeLines (после
правок выработки, частичных записей под 429 и т.п.). Симптом рассинхрона: вкладка
«Дефицит» показывает реальную нехватку, а «Главная» (Dashboard) — всё «Норма», т.к.
брала need из устаревшего Need. **Why:** две параллельные модели спроса всегда
разъезжаются — держим единый источник. Главная при этом законно отличается шкалой
(4-уровневый коэф. покрытия on_hand/need + учёт inbound), а «Дефицит» — сигналом
critical/transfer/ok без inbound; это не баг.
