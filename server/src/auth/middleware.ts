/**
 * Auth middleware: проверяет `Authorization: Bearer <token>`, находит сессию
 * по хешу токена, кладёт пользователя в `req.user`.
 */
import { Request, Response, NextFunction } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/client";
import { session, user, UserRole } from "../db/schema";
import { hashToken } from "./tokens";

export interface AuthedUser {
  id: number;
  login: string;
  name: string;
  role: UserRole;
  organizationId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function loadUser(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.authorization ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const tokenHash = hashToken(token);
  const nowIso = new Date().toISOString();

  const rows = await db
    .select({
      uid: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      active: user.active,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.tokenHash, tokenHash), gt(session.expiresAt, nowIso)));

  const row = rows[0];
  if (!row || !row.active) return null;
  return {
    id: row.uid,
    login: row.login,
    name: row.name,
    role: row.role as UserRole,
    organizationId: row.organizationId,
  };
}

/**
 * ВРЕМЕННО: авторизация полностью отключена по просьбе пользователя.
 * Пока флаг = true, любой запрос проходит как встроенный admin-пользователь,
 * без проверки токена. Чтобы вернуть нормальный вход — поставить false.
 */
const AUTH_DISABLED = true;

const DEV_USER: AuthedUser = {
  id: 0,
  login: "dev@klm.by",
  name: "Разработка (авторизация отключена)",
  role: "admin",
  organizationId: null,
};

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (AUTH_DISABLED) {
    req.user = DEV_USER;
    next();
    return;
  }
  const u = await loadUser(req);
  if (!u) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }
  req.user = u;
  next();
}

export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (AUTH_DISABLED) {
      req.user = DEV_USER;
      next();
      return;
    }
    const u = await loadUser(req);
    if (!u) { res.status(401).json({ error: "Не авторизован" }); return; }
    if (!allowed.includes(u.role)) { res.status(403).json({ error: "Доступ запрещён" }); return; }
    req.user = u;
    next();
  };
}
