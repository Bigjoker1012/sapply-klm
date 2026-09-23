---
name: drizzle-kit push SQL-expression default drift
description: Why drizzle-kit push re-issues ALTER COLUMN SET DEFAULT for to_char/now() defaults on every run
---

# drizzle-kit push re-applies SQL-expression column defaults every run

When a pg-core column uses a raw SQL expression as its default (e.g. a
`to_char(now() AT TIME ZONE 'UTC', ...)` ISO-8601 timestamp default), `drizzle-kit
push` cannot fully introspect the stored expression back into the same normalized
form. As a result it detects a phantom diff and re-issues
`ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...` for those columns on **every**
push, even when nothing changed.

**Why:** This is harmless — the statements are idempotent and converge to the same
default. It just makes `drizzle-kit push` / post-merge logs noisy and never reaches
a true "no changes" state for those columns.

**How to apply:** Do not treat repeated `SET DEFAULT` lines in push output as a bug
or as data risk. If a perfectly clean push is required, switch those defaults to
`defaultNow()` / a literal, or move ISO timestamp formatting into app code. For this
repo the SQL-expression defaults are intentional (ISO-8601 strings), so the noise is
accepted.
