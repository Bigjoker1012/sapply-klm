/**
 * Прокатка миграций. Запускается отдельным скриптом или при старте.
 *
 * Применяет всё из `server/src/db/migrations/` в лексикографическом порядке.
 * Состояние трекается в таблице `__migrations(name, applied_at)`.
 * Это упрощённая замена drizzle-kit migrate — нам нужна поддержка
 * custom-миграций с триггерами, которые drizzle-kit генерить не умеет.
 */
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

export function runMigrations(dbPath: string): { applied: string[]; skipped: string[] } {
  const dir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set<string>(
    (sqlite.prepare("SELECT name FROM __migrations").all() as { name: string }[]).map((r) => r.name)
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const f of files) {
    if (done.has(f)) { skipped.push(f); continue; }
    const sql = fs.readFileSync(path.join(dir, f), "utf-8");
    // drizzle-kit маркирует statements `--> statement-breakpoint`,
    // better-sqlite3 умеет глотать весь скрипт за раз через exec().
    const cleaned = sql.split(/-->\s*statement-breakpoint/g).join("\n");
    const tx = sqlite.transaction(() => {
      sqlite.exec(cleaned);
      sqlite.prepare("INSERT INTO __migrations (name) VALUES (?)").run(f);
    });
    tx();
    applied.push(f);
  }

  sqlite.close();
  return { applied, skipped };
}

if (require.main === module) {
  const raw = process.env.DATABASE_URL;
  const dbPath = (!raw || /^postgres(ql)?:\/\//i.test(raw))
    ? path.resolve(process.cwd(), "data/supply-klm.db")
    : raw;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const { applied, skipped } = runMigrations(dbPath);
  console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "(none)"}`);
  if (skipped.length) console.log(`Already applied: ${skipped.join(", ")}`);
}
