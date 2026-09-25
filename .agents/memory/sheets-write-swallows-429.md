---
name: writeRange/sheetPut swallow 429
description: Sheets write helpers don't check the proxy error body, so writes can silently fail under rate limit
---

FIXED: the proxy write path now routes through `proxyWrite()` which (like `sheetGet`) retries rate-limit and THROWS on any `{error}` body, so `sheetPost`/`sheetPut` (→ `writeRange`/`appendRows`/`addInbound`/`deleteInboundByMaterial`) no longer report phantom success. The direct-SA (`GOOGLE_SA_JSON`) path already threw via axios. Read-back is still a cheap belt-and-suspenders check but no longer mandatory for catching silent 429s.

**Why:** during a burst of Sheets ops a single-cell write reported success but a fresh read (separate ts-node process = empty in-memory cache) showed the old value; nothing was corrupted, the write just never landed. Cost several wasted retry cycles chasing a phantom indexing/cache bug. The original swallow happened because the proxy path returned `r.json()` (which can be `{error:{...}}`) as success without inspection.

**How to apply:**
- After any important Sheets write, read the cell back (in a calmer moment / separate call) to confirm persistence before trusting it.
- Space out write bursts; the client rate-limiter (≤8 RPS) + retry only covers reads via `sheetGet`, not writes.
- Killed ts-node probes can linger as background processes and keep hitting the shared Google quota (quota is per-repl, not per-process), starving new probes into `-1` kills. If probes start dying with no output, check `ps` for stray probe processes; a workflow restart reaps them. A lingering stray may also complete its write later, so re-read before re-writing.
