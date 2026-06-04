---
name: Sheets vs Postgres data-source split
description: Recognition flow lives in Google Sheets; dashboard lives in Postgres — read each from its own store
---

The app is a half-finished Sheets→Postgres migration. The two stores are NOT in sync at runtime.

- **Recognition / upload flow = Google Sheets.** `matchBatch` reads `Syryo`+`Aliases`; uploads append unmatched names to `ReviewQueue`; confirm writes `Aliases` + marks `ReviewQueue` resolved. Endpoints: `GET /api/upload/unmatched`, `POST /api/upload/unmatched/confirm`, `GET/POST /api/raw-materials` (Syryo catalog, 68 SKUs).
- **Dashboard decisions / stock = Google Sheets** (since the «простой светофор» fix). `computeDecisions`/`loadAggregates` in `dashboard.ts` now read the SAME Sheets source as planning (`getAllRawMaterials/getLatestPlantStock/getLatestLipStock/getInboundTotals/getNeedTotals`). Before, they read empty Postgres `batch`/`in_transit`/`production_plan` → the 4 status counters were frozen (e.g. 58/0/0/10 = just SKUs with seeded `min_stock_kg` vs not). `GET /api/dashboard/all`'s `rawMaterials`/`unmatched`/`inbound`/`status` STILL come from Postgres (catalog list, review queue, archive) — only the decisions/counters moved to Sheets.
- **Traffic-light status (no manual thresholds):** 🔴 on_hand(=plant+lip+inbound)≈0 · 🟡 0<on_hand<need · 🔵 need≤on_hand<need*1.2 · 🟢 else. **cover_by_transfer/purchase pitfall:** lip is ALREADY inside on_hand, so purchase = max(0, need−on_hand); transfer must be computed against Polotsk-only deficit `max(0, need−(plant+inbound))`, else you double-count Lipkovskaya.
- **Остатки (stock qty) live ONLY in Sheets.** Upload writes Полоцк→`PlantStock`, Липковская→`LipStock`/`LipBatches`, в пути→`Inbound`. Postgres `batch`/`in_transit` are EMPTY in this flow → any feature needing qty_today must read `getLatestPlantStock()+getLatestLipStock()+getInboundTotals()` (Map keyed by raw_uid), NOT Postgres SUM(batch). Planning page bug was exactly this.

**Why this matters:** the recognition UI block must read `unmatched` and its catalog from the **Sheets** endpoints (`/api/upload/unmatched`, `/api/raw-materials`), NOT from `/dashboard/all`. Using the Postgres `unmatched` shows 0 even when uploads reported "N не распознано" — a confusing contradiction the user hit.

- **Рецепты = виртуальное списание через лист `Need`, не трогают остатки.** Загрузка рецепта пишет потребность в `Need` (recipe_uid в col B). Доступное = остаток − `getNeedTotals()` (так и на дашборде, и в планировании). «Откат рецепта» = удаление документа-рецепта в архиве → снимает строки `Need` этого рецепта (`deleteNeedByRecipe`), количества возвращаются. Связь документ↔рецепт через `document_archive.recipe_uid`. Откат: сначала чистим Need, потом удаляем документ (иначе потеря возможности повтора при сбое Sheets).

**How to apply:** when wiring any recognition/aliases/catalog feature, stay on the Sheets endpoints so raw_uid keys line up with what `matchBatch` and `addAlias` use. `ReviewQueue` accumulates duplicates across re-uploads (no dedup on append) — dedup by `original_text` in the UI and resolve all queue rows sharing that text on confirm.
