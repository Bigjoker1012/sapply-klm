---
name: writeRange/sheetPut swallow 429
description: Sheets write helpers don't check the proxy error body, so writes can silently fail under rate limit
---

`writeRange` / `appendRows` / `sheetPut` do NOT inspect the proxy response body, unlike `readRange` (which throws on `{error}`). Under a 429/RESOURCE_EXHAUSTED the PUT/POST is rejected but the helper still resolves and the caller logs "OK" — a false success. The data simply isn't written.

**Why:** during a burst of Sheets ops a single-cell write reported success but a fresh read (separate ts-node process = empty in-memory cache) showed the old value; nothing was corrupted, the write just never landed. Cost several wasted retry cycles chasing a phantom indexing/cache bug.

**How to apply:**
- After any important Sheets write, read the cell back (in a calmer moment / separate call) to confirm persistence before trusting it.
- Space out write bursts; the client rate-limiter (≤8 RPS) + retry only covers reads via `sheetGet`, not writes.
- Killed ts-node probes can linger as background processes and keep hitting the shared Google quota (quota is per-repl, not per-process), starving new probes into `-1` kills. If probes start dying with no output, check `ps` for stray probe processes; a workflow restart reaps them. A lingering stray may also complete its write later, so re-read before re-writing.
