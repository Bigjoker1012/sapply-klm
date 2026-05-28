/**
 * Токены сессий.
 * Клиенту отдаём сырой `token` (base64url от 32 случайных байт).
 * В БД храним `SHA-256(token)` — при утечке дампа активные сессии бесполезны.
 */
import crypto from "crypto";

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
