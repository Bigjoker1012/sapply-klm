/**
 * Бутстрап: при старте сервера прокатывает миграции и сидит организацию,
 * базовые склады и 4-х seed-пользователей (admin/snabzhenets/tehnolog/viewer)
 * с паролем по умолчанию, чтобы можно было залогиниться сразу.
 *
 * SEED_USER_PASSWORD из env, иначе "klm2026" (как было в старой in-memory).
 */
import path from "path";
import bcrypt from "bcrypt";
import { runMigrations } from "../db/migrate";
import { db } from "../db/client";
import { user, organization, warehouse, UserRole } from "../db/schema";
import { sql } from "drizzle-orm";

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD ?? "klm2026";
const IS_PROD = process.env.NODE_ENV === "production";

function resolveSqlitePath(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw || /^postgres(ql)?:\/\//i.test(raw)) {
    return path.resolve(process.cwd(), "data/supply-klm.db");
  }
  return raw;
}

interface SeedUser {
  login: string;
  name: string;
  role: UserRole;
}

const SEED_USERS: SeedUser[] = [
  { login: "admin@klm.by", name: "Руководитель",                 role: "admin" },
  { login: "sz@klm.by",    name: "Специалист по закупкам",        role: "snabzhenets" },
  { login: "t@klm.by",     name: "Технолог",                      role: "tehnolog" },
  { login: "kp@klm.by",    name: "Кладовщик",                     role: "viewer" },
];

export async function bootstrap(): Promise<void> {
  // В проде нельзя использовать дефолтный пароль — это явная подсказка взломщику.
  if (IS_PROD && !process.env.SEED_USER_PASSWORD) {
    throw new Error("В production обязательно задайте SEED_USER_PASSWORD в env (отличный от дефолта).");
  }

  const dbPath = resolveSqlitePath();
  const { applied, skipped } = runMigrations(dbPath);
  if (applied.length) console.log(`[db] Migrations applied: ${applied.join(", ")}`);
  if (skipped.length) console.log(`[db] Migrations already at version: ${skipped[skipped.length - 1]}`);

  // Сид. INSERT OR IGNORE по уникальным ключам — идемпотентно при повторных
  // запусках и устойчиво к гонкам параллельных bootstrap-ов.
  // Делаем в одной транзакции — либо всё, либо ничего.
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  const orgId: number = db.transaction((dbx) => {
    dbx.run(sql`
      INSERT OR IGNORE INTO organization (code, name)
      VALUES ('KHP_POLOTSK', 'Полоцкий КХП')
    `);
    const oid = (dbx.get(sql`SELECT id FROM organization WHERE code = 'KHP_POLOTSK'`) as { id: number }).id;

    dbx.run(sql`
      INSERT OR IGNORE INTO warehouse (organization_id, code, name, is_main)
      VALUES (${oid}, 'POLOTSK', 'Полоцк', 1)
    `);
    dbx.run(sql`
      INSERT OR IGNORE INTO warehouse (organization_id, code, name, is_main)
      VALUES (${oid}, 'LIPKOV', 'Липковская', 0)
    `);

    for (const u of SEED_USERS) {
      dbx.run(sql`
        INSERT OR IGNORE INTO user (login, password_hash, name, role, organization_id, active)
        VALUES (${u.login}, ${passwordHash}, ${u.name}, ${u.role}, ${oid}, 1)
      `);
    }
    return oid;
  });

  console.log(`[seed] organization=${orgId}, warehouses + ${SEED_USERS.length} users (idempotent INSERT OR IGNORE)`);
  if (!IS_PROD && !process.env.SEED_USER_PASSWORD) {
    console.log(`[seed] dev-режим: используется встроенный seed-пароль. Для прода задайте SEED_USER_PASSWORD в env.`);
  }

  // Сид каталога SKU из коммитнутого JSON-снимка. В проде dev-БД из data/ не
  // коммитится, поэтому без этого приложение поднялось бы с пустым каталогом.
  // Идемпотентно. Ошибка сида не должна ронять сервер — логируем и продолжаем.
  try {
    const { runCatalogSeed } = await import("../scripts/seed-catalog");
    const r = runCatalogSeed();
    console.log(`[seed] catalog: sku inserted ${r.inserted}, skipped ${r.skipped} (supplier placeholder id=${r.supplierId})`);
  } catch (err) {
    console.warn("[seed] catalog seed пропущен (не критично для старта):", (err as Error).message);
  }
}
