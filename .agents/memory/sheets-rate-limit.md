---
name: Google Sheets rate limit throttle
description: Why all Sheets calls go through a global RPS limiter, not just the cache.
---

# Google Sheets ~10 req/s per repl → global throttle required

Google Sheets API limits to ~10 requests/sec **per repl**. The dashboard
(`/dashboard/all`) reads 5+ ranges in one `Promise.all`, and the stock tabs
(`/stock/live`, `/stock/deficit`) plus client polling fire concurrently — bursts
hit 11–13 req/s and the overflow comes back 429, which `readRange` surfaces as a
500 ("Sheets readRange … failed: Rate limit exceeded: 11/10 RPS").

The 30s TTL cache does NOT prevent this: it only helps repeat reads, not the
initial cold burst, and any write calls `invalidateCache()` so the next dashboard
load is cold again.

**Fix in place:** every Sheets HTTP call (`sheetGet`/`sheetPost`/`sheetPut`) goes
through `acquireSlot()` — a serialized token-bucket capping ≤ `MAX_RPS` (8) per
rolling second — and `sheetGet` retries rate-limited responses with quadratic
backoff. Detection (`isRateLimited`) must cover BOTH paths: service-account axios
throws (429 / `response.status`), but the ReplitConnectors proxy does NOT throw —
it returns body `{error:{...}}` with message "Rate limit exceeded".

**Why:** removing the throttle (or only relying on cache) reintroduces the 500
storm under normal multi-tab usage.

**How to apply:** keep MAX_RPS comfortably under 10 (headroom for concurrent
activity). If you add new Sheets-reading endpoints or widen `Promise.all` fan-out,
they automatically inherit the limiter — do not bypass it with a direct axios call.
