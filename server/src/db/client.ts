/**
 * PostgreSQL-клиент Drizzle (Replit-managed Postgres). Один shared connection
 * pool на процесс.
 *
 * Использование:
 *   import { db } from "./db/client";
 *   import { sku } from "./db/schema";
 *   const items = await db.select().from(sku).where(eq(sku.active, true));
 *
 * Схема БД применяется НЕ приложением:
 *   - dev:  `npm run db:push` (drizzle-kit) + post-merge скрипт;
 *   - prod: diff dev→prod при публикации Replit.
 * Поэтому здесь только подключение — никакого DDL при старте.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL не задан. Создайте Replit PostgreSQL (Database tool) — он выставит DATABASE_URL.",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
