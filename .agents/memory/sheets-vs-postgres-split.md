---
name: Sheets vs Postgres data-source split
description: Recognition flow lives in Google Sheets; dashboard lives in Postgres — read each from its own store
---

The app is a half-finished Sheets→Postgres migration. The two stores are NOT in sync at runtime.

- **Recognition / upload flow = Google Sheets.** `matchBatch` reads `Syryo`+`Aliases`; uploads append unmatched names to `ReviewQueue`; confirm writes `Aliases` + marks `ReviewQueue` resolved. Endpoints: `GET /api/upload/unmatched`, `POST /api/upload/unmatched/confirm`, `GET/POST /api/raw-materials` (Syryo catalog, 68 SKUs).
- **Dashboard decisions / stock = Postgres.** `GET /api/dashboard/all` reads `sku`, `batch`, `in_transit`, `upload_row` — its `unmatched` comes from Postgres `upload_row`, which the upload route NEVER writes to.
- **Остатки (stock qty) live ONLY in Sheets.** Upload writes Полоцк→`PlantStock`, Липковская→`LipStock`/`LipBatches`, в пути→`Inbound`. Postgres `batch`/`in_transit` are EMPTY in this flow → any feature needing qty_today must read `getLatestPlantStock()+getLatestLipStock()+getInboundTotals()` (Map keyed by raw_uid), NOT Postgres SUM(batch). Planning page bug was exactly this.

**Why this matters:** the recognition UI block must read `unmatched` and its catalog from the **Sheets** endpoints (`/api/upload/unmatched`, `/api/raw-materials`), NOT from `/dashboard/all`. Using the Postgres `unmatched` shows 0 even when uploads reported "N не распознано" — a confusing contradiction the user hit.

**How to apply:** when wiring any recognition/aliases/catalog feature, stay on the Sheets endpoints so raw_uid keys line up with what `matchBatch` and `addAlias` use. `ReviewQueue` accumulates duplicates across re-uploads (no dedup on append) — dedup by `original_text` in the UI and resolve all queue rows sharing that text on confirm.
