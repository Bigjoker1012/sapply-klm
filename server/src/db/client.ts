/**
 * SQLite-клиент Drizzle. Один shared-instance на процесс.
 *
 * Использование:
 *   import { db } from "./db/client";
 *   import { sku } from "./db/schema";
 *   const items = await db.select().from(sku).where(eq(sku.active, true));
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import * as fs from "fs";
import * as path from "path";

const dbPath = process.env.DATABASE_URL ?? path.resolve(process.cwd(), "data/supply-klm.db");

// Гарантируем что директория существует
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const sqlite = new Database(dbPath);

// WAL для одновременных read/write, foreign_keys чтобы FK работали
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;
