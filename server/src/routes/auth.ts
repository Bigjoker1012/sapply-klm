/**
 * Auth routes: login / logout / me.
 *
 * Login flow:
 *   1. Клиент POST /api/auth/login {email, password}.
 *   2. Сервер находит user по login=email, проверяет bcrypt-хеш пароля.
 *   3. Генерируется новый случайный токен; в session кладём только SHA-256(token).
 *   4. Клиенту возвращается сырой токен + профиль.
 *
 * Совместимость со старым фронтом: возвращаем поле `role` как короткий
 * русский код (Р/СЗ/Т/КП) — фронт пока на нём построен.
 */
import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db } from "../db/client";
import { user, session, UserRole } from "../db/schema";
import { generateToken, hashToken } from "../auth/tokens";
import { requireAuth } from "../auth/middleware";

const router = Router();

const SESSION_TTL_DAYS = 14;

/** Анти-timing dummy bcrypt-хеш (от строки "dummy"). Один раз генерим лениво. */
let DUMMY_HASH: string | null = null;
async function ensureDummyHash(): Promise<string> {
  if (!DUMMY_HASH) DUMMY_HASH = await bcrypt.hash("dummy", 10);
  return DUMMY_HASH;
}

/**
 * Простой in-memory rate-limit на /login.
 * Ключ = ip|login (lowercase). 10 неудачных попыток за 15 минут → 429.
 * После успешного входа счётчик сбрасывается.
 * Для одного-двух инстансов — достаточно; при горизонтальном масштабировании
 * переехать на Redis.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();

function rateKey(req: Request, login: string): string {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();
  return `${ip}|${login}`;
}
function rateCheck(key: string): { blocked: boolean; remaining: number } {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.resetAt < now) return { blocked: false, remaining: LOGIN_MAX_ATTEMPTS };
  return { blocked: e.count >= LOGIN_MAX_ATTEMPTS, remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - e.count) };
}
function rateMiss(key: string): void {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.resetAt < now) attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else e.count += 1;
}
function rateReset(key: string): void { attempts.delete(key); }

// Периодическая чистка протухших записей
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}, 5 * 60 * 1000).unref();

/** Маппинг enum-роли БД → короткий код для текущего фронта. */
const ROLE_DISPLAY: Record<UserRole, string> = {
  admin: "Р",
  snabzhenets: "СЗ",
  tehnolog: "Т",
  viewer: "КП",
};

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Укажите email и пароль" });
  }

  const login = email.trim().toLowerCase();
  const key = rateKey(req, login);
  const { blocked } = rateCheck(key);
  if (blocked) {
    return res.status(429).json({ error: "Слишком много попыток входа. Попробуйте позже." });
  }

  const rows = db.select().from(user).where(eq(user.login, login)).all();
  const u = rows[0];

  // Унифицированное сообщение и единое время отклика, чтобы не подсказывать,
  // что пользователь существует / был угадан логин:
  // bcrypt.compare выполняем ВСЕГДА — против реального или dummy-хеша.
  const invalidMsg = { error: "Неверный email или пароль" };
  const hashToCheck = u?.passwordHash ?? (await ensureDummyHash());
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!u || !u.active || !passwordOk) {
    rateMiss(key);
    return res.status(401).json(invalidMsg);
  }
  rateReset(key);

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  db.insert(session).values({
    tokenHash,
    userId: u.id,
    expiresAt,
    ip: (req.ip ?? req.socket.remoteAddress ?? "").toString().slice(0, 64),
  } as any).run();

  db.update(user).set({ lastLoginAt: new Date().toISOString() } as any).where(eq(user.id, u.id)).run();

  return res.json({
    token,
    expiresAt,
    user: {
      email: u.login,
      role: ROLE_DISPLAY[u.role as UserRole],
      roleCode: u.role,
      name: u.name,
    },
  });
});

router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    db.delete(session).where(eq(session.tokenHash, hashToken(token))).run();
  }
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const u = req.user!;
  return res.json({
    user: {
      email: u.login,
      role: ROLE_DISPLAY[u.role],
      roleCode: u.role,
      name: u.name,
    },
  });
});

router.post("/register", (_req: Request, res: Response) => {
  res.status(400).json({ error: "Регистрация отключена. Обратитесь к администратору." });
});

export default router;
