---
name: Drizzle 0.36 insert types
description: drizzle-orm 0.36.x с better-sqlite3 даёт слишком узкие типы для insert-values на колонках с .default(); реальная вставка работает.
---

В drizzle-orm 0.36.4 + drizzle-orm/better-sqlite3 типы `.values({...})` ошибочно требуют поля, у которых на уровне схемы стоит `.default(...)` (timestamps через `strftime`, `active = 1`, `is_main = 0` и т.п.). На runtime всё работает.

**Два варианта обхода:**
1. Точечный `as any` на объекте values — быстро, но прячет реальный type-drift схемы.
2. Лучше: для bootstrap/seed-кода писать сырой `db.run(sql\`INSERT OR IGNORE INTO ... VALUES (...)\`)`. Бонусом получаешь идемпотентность и устойчивость к гонкам параллельных стартов без `as any`.

**Why:** на проекте supply-klm уже столкнулись 4 раза в одном PR. Решение через `INSERT OR IGNORE` в транзакции одновременно убрало `as any` и заменило хрупкий `if (count===0)` сид на самовосстанавливающийся.

**How to apply:** в типизированных рантайм-роутах (login/logout: вставки в session, update user) — `as any` локально с комментарием. В bootstrap/миграциях — raw `sql\`...\`` через `db.transaction`.
