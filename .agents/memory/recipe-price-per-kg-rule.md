---
name: Recipe "price per 1 kg" ownership rule
description: How recipe rows are split into our materials vs plant materials, and the Excel column-collision trap.
---
INVERTED rule (current). In premix recipes the «Цена за 1 кг» column marks ownership:
- price > 0  → OUR material (procurement / списание with stock) — goes into breakdown.
- price = 0  → the plant's own material (завод) — EXCLUDED from matching/Need/queue/списание, tagged `match_status: "plant"`, counted separately.
- price unknown (null) → treat as OURS (do not drop it).

`pricePerKg` is `number | null`. `isPlant = (pricePerKg === 0)` ONLY; everything else (null or >0) is ours. The /recipe handler runs matchBatch on rows where `!isPlant`.

**Why:** The user reversed the original convention. Earlier the code treated price=0 as ours; now priced rows are ours and zero-priced rows are the plant's. Treating null as ours avoids silently dropping our materials when the source has no price column.

**How to apply:**
- excelParser: empty price cell / no price column → `null`; an explicit 0 stays `0`.
- pdfParser text-layer & OCR paths → `null` (price not reliably readable).
- aiMatcher vision prompt: return 0 ONLY if the cell literally shows 0; empty cell or no price column → `null`.

**Excel column-collision trap (unchanged):** the header «Цена за 1 кг» contains «кг», so a qty-column detector matching «кг» grabs the PRICE column. Detect the price column FIRST (by «цена»), then exclude its index when searching for the расход/qty column. Prefer «г/т»/«норм»/«расход» for qty before falling back to «кг».
