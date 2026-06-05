---
name: Sheets read errors silently poison the cache
description: Why a transient Google Sheets read failure caused systematic "0 строк распознано" on recipe upload, and the invariant that prevents it.
---

# Симптом
Загрузка рецепта периодически даёт «0 строк распознано» (matched=0) ПАЧКАМИ —
несколько загрузок подряд, потом само проходит. Логика сопоставления при этом
исправна: повтор matchBatch на тех же данных стабильно даёт 8–13 из 17.

# Корень
`readRange` (sheetsService) на прокси-пути (ReplitConnectors) возвращает тело
ответа как есть: `return r.json()`. При ошибке Sheets API (429 rate-limit, 401
протух токен, 5xx) тело = `{error:{...}}` БЕЗ поля `values`. Старый код делал
`d.values || []` → молча отдавал `[]` И КЭШИРОВАЛ его на CACHE_TTL (30 c).
Один сбойный read отравлял кэш диапазона на 30 c → matchBatch видел пустой
каталог/синонимы → все null → рецепт сохранялся со всеми unmatched. Отсюда
«пачками».

**Why:** axios-путь (когда задан GOOGLE_SERVICE_ACCOUNT_JSON) уже бросал на HTTP
4xx/5xx — поэтому баг проявлялся только в коннектор-режиме (прод/дев без SA).

# Правило
- `readRange`: при `d.error` — БРОСАТЬ и НЕ кэшировать. Легитимно пустой диапазон
  (нет `error`, нет `values`) по-прежнему отдаёт `[]`.
- `matchBatch`: каталог Syryo — инвариант, пустым не бывает. `if(!materials.length) throw`.
  matchBatch вызывается ДО writeRecipe в /upload/recipe → бросок прерывает чисто,
  частичный рецепт не пишется, маршрут отдаёт 500, клиент показывает ошибку (повтор).

**How to apply:** любой молчаливый `x || []`/`?? []` на ответе Sheets/коннектора —
подозрителен: ошибка чтения != пустые данные. Та же дыра возможна в
`sheetPost/sheetPut` (write-side) — там тоже стоит проверять `{error}` при доработке.
