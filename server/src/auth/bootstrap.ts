/**
 * Бутстрап: при старте сервера сидит организацию, базовые склады и 4-х
 * seed-пользователей (admin/snabzhenets/tehnolog/viewer) с паролем по
 * умолчанию, чтобы можно было залогиниться сразу.
 *
 * Схему БД создаёт НЕ этот код (drizzle-kit push в dev / publish-diff в prod) —
 * здесь только идемпотентный сид данных (DML, не DDL).
 *
 * SEED_USER_PASSWORD из env, иначе "klm2026" (как было в старой in-memory).
 */
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { user, organization, warehouse, UserRole } from "../db/schema";

const BCRYPT_ROUNDS = 10;
const DEFAULT_PASSWORD = process.env.SEED_USER_PASSWORD ?? "klm2026";
const IS_PROD = process.env.NODE_ENV === "production";

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

  // Сид. onConflictDoNothing по уникальным ключам — идемпотентно при повторных
  // запусках и устойчиво к гонкам параллельных bootstrap-ов.
  // Делаем в одной транзакции — либо всё, либо ничего.
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  const orgId = await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values({ code: "KHP_POLOTSK", name: "Полоцкий КХП" } as any)
      .onConflictDoNothing();
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.code, "KHP_POLOTSK"));
    const oid = org.id;

    await tx
      .insert(warehouse)
      .values([
        { organizationId: oid, code: "POLOTSK", name: "Полоцк", isMain: true },
        { organizationId: oid, code: "LIPKOV", name: "Липковская", isMain: false },
      ] as any)
      .onConflictDoNothing();

    for (const u of SEED_USERS) {
      await tx
        .insert(user)
        .values({
          login: u.login,
          passwordHash,
          name: u.name,
          role: u.role,
          organizationId: oid,
          active: true,
        } as any)
        .onConflictDoNothing();
    }
    return oid;
  });

  console.log(`[seed] organization=${orgId}, warehouses + ${SEED_USERS.length} users (idempotent onConflictDoNothing)`);
  if (!IS_PROD && !process.env.SEED_USER_PASSWORD) {
    console.log(`[seed] dev-режим: используется встроенный seed-пароль. Для прода задайте SEED_USER_PASSWORD в env.`);
  }

  // Сид каталога SKU из коммитнутого JSON-снимка. В проде каталог надо наполнить
  // при первом старте. Идемпотентно. Ошибка сида не должна ронять сервер —
  // логируем и продолжаем.
  try {
    const { runCatalogSeed } = await import("../scripts/seed-catalog");
    const r = await runCatalogSeed();
    console.log(`[seed] catalog: sku inserted ${r.inserted}, skipped ${r.skipped} (supplier placeholder id=${r.supplierId})`);
  } catch (err) {
    console.warn("[seed] catalog seed пропущен (не критично для старта):", (err as Error).message);
  }
}
