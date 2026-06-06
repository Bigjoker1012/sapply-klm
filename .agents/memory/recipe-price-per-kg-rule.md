---
name: Recipe "price per 1 kg" ownership rule
description: How recipe rows are split into our materials vs plant materials, and the Excel column-collision trap.
---
In premix recipes, the «Цена за 1 кг» (price per 1 kg) column marks ownership: OUR materials have price 0/empty; rows with price > 0 are the plant's (завод) own raw materials. Only price=0 rows go into the breakdown — matching, Need (procurement), and the unmatched review queue. Priced rows are tagged `match_status: "plant"`, counted separately, and excluded from everything procurement-related.

**Why:** The plant supplies its own components; counting them would inflate procurement need and pollute the unmatched recognition queue with items we never buy.

**How to apply:**
- Parsers carry `pricePerKg` per row (Excel column, vision prompt extracts «Цена»). Text-layer & OCR PDF paths default `pricePerKg=0` (conservative — never wrongly drop our materials, since OCR price is unreliable).
- The /recipe handler runs matchBatch ONLY on rows with `!(pricePerKg>0)`, and skips plant rows from alias/Need/queue.

**Excel column-collision trap:** the header «Цена за 1 кг» contains the substring «кг», so a qty-column detector that matches «кг» will grab the PRICE column by mistake. Detect the price column FIRST (by «цена»), then exclude its index when searching for the расход/qty column. Prefer «г/т»/«норм»/«расход» for qty before falling back to «кг».
