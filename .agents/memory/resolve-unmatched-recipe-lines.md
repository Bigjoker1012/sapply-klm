---
name: Resolving unmatched recipe lines
description: Why adding an alias alone does NOT fix an already-uploaded recipe; what must be patched.
---
Recipe parsing is NOT live. The "Разобрать на строки" button is just a normal upload; match results, RecipeLines and Need are written ONCE at upload time and stored statically. There is no endpoint that re-matches an existing recipe.

**Consequence:** To resolve unmatched lines of an ALREADY-uploaded recipe so it shows as recognized AND contributes to procurement need, you must do all of:
1. Patch the line's `RecipeLines` row: col C (r[2]) = raw_uid, col L (r[11]) = `matched`.
2. Append a `Need` row: `[NEED_id, recipe_uid, raw_uid, period(YYYY-MM), qty, 0, qty, ISO]` where qty = the line's consumption_kg (RecipeLines col H / r[7]). getNeedTotals sums col G (r[6]).
3. Add the alias (raw_uid + EXACT line text) — this only helps FUTURE uploads, not the current recipe.

**Why:** `/api/upload/unmatched/confirm` only does addAlias + resolveQueueItem — it does NOT touch RecipeLines or Need. So confirming a queue item leaves the current recipe at its old match count and missing procurement need for that material.

**How to apply:** Re-uploading would re-match via aliases but creates a duplicate recipe (double-counts Need unless old recipe deleted first) and re-OCR may extract slightly different text → alias misses. For a single known recipe, direct Sheets patch (above) is the reliable fix. Don't double-count: only append Need for lines that were previously unmatched.
