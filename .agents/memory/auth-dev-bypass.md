---
name: requireAuth dev bypass
description: AUTH_DISABLED makes every requireAuth route return 200 in dev, so curl can't verify auth gating
---

`requireAuth`/`requireRole` short-circuit to a `DEV_USER` when `AUTH_DISABLED` is set (dev). So in the Replit dev workspace EVERY endpoint answers 200 with no cookie, whether or not it has `requireAuth`.

**Why:** after adding `router.use(requireAuth)` to `/api/in-transit`, a `curl` with no auth still returned 200 — same as `/api/planning` (which was already protected). That is the dev bypass, not a missing guard. The gating only actually takes effect in production where `AUTH_DISABLED` is false.

**How to apply:**
- Don't use a dev-workspace curl to "prove" an endpoint is unauthenticated — it always passes. Verify by reading the router (`router.use(requireAuth)`) instead.
- Mutating routers (e.g. `/api/in-transit`) should mount `requireAuth` at router level for parity with planning/recipes/stock/dashboard; the frontend already rides the same session so adding it is safe.
