---
name: SQLite DATABASE_URL guard
description: better-sqlite3 принимает любой путь; postgres-URL в env создаёт мусорную директорию с креденшелами в имени.
---

В Replit-среде `DATABASE_URL` часто заранее установлен в postgres-URL вида `postgresql://user:password@host/db?...`. Если код проекта берёт его как путь к SQLite-файлу (`new Database(process.env.DATABASE_URL ?? 'data/x.db')`), better-sqlite3 послушно создаст директорию `postgresql:/` и файл с именем `user:password@host/db?...` внутри — то есть пароль попадает в имя файла в репо.

**Правило:** в любом месте, где SQLite-путь берётся из env, фильтруй:
```ts
const raw = process.env.DATABASE_URL;
const dbPath = (!raw || /^postgres(ql)?:\/\//i.test(raw))
  ? path.resolve(process.cwd(), "data/<app>.db")
  : raw;
```

**Why:** инцидент уже был — в корне репо появился `postgresql:/postgres:password@helium/heliumdb?sslmode=disable` со 250 КБ нашего SQLite внутри. Креденшелы при коммите утекли бы в git.

**How to apply:** в каждом месте, где открывается better-sqlite3 (`client.ts`, `migrate.ts`, любой воркер), плюс в `.gitignore` добавить `data/`, `*.db`, `*.db-shm`, `*.db-wal`.
