---
name: drizzle-kit push требует TTY
description: Почему db:push падает в агенте и как применять новую схему
---

`npm run db:push` (drizzle-kit push) в агентном/неинтерактивном шелле падает с
«Interactive prompts require a TTY terminal»: kit задаёт подтверждение и не может
прочитать ответ (stdin/stdout не TTY).

**Как применять изменения схемы:** выполнять сгенерированный DDL напрямую через
SQL (executeSql в code_execution или psql), а не через push. Для новой таблицы —
`CREATE TABLE IF NOT EXISTS ...` ровно тем DDL, что печатает push перед промптом.
Прочие `ALTER ... SET DEFAULT to_char(now()...)` из вывода push — идемпотентные
сбросы дефолтов времени, их применять не обязательно.

**Why:** push в этой среде нельзя автоматизировать (нет флага обхода TTY в
используемой версии 0.31). Прямой DDL — единственный надёжный путь.
**How to apply:** после правки `server/src/db/schema.ts` бери DDL из вывода
`npm run db:push` (он печатается до ошибки) и прогоняй через executeSql.
