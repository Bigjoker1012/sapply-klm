---
name: Login hardening pattern
description: Обязательный минимум защиты /login: anti-timing dummy bcrypt, rate-limit по ip|login, единое сообщение об ошибке.
---

Архитект-ревью отбрасывает любой `/login`, в котором:
- `if (!user) return 401` стоит до `bcrypt.compare` — это timing-side-channel: существующий пользователь отвечает за ~50 мс, несуществующий за ~1 мс.
- нет rate-limit — bearer-токены + известные seed-логины = брутфорс открыт.
- сообщения различают «нет пользователя» и «неверный пароль» — энумерация логинов.

**Минимальный паттерн (in-memory, для 1–2 инстансов):**
- Один dummy-bcrypt-хеш (`bcrypt.hash('dummy', 10)`), генерится лениво и кэшируется.
- `bcrypt.compare(password, user?.passwordHash ?? dummy)` ВСЕГДА, даже если юзера нет.
- Решение «пускать» — единым `if (!u || !u.active || !ok)`.
- `Map<ip|login, {count, resetAt}>`, 10 попыток / 15 мин → 429, сброс при успехе, `setInterval(...).unref()` чистит протухшее.
- Текст ошибки один на все случаи: «Неверный email или пароль».

**Why:** реальный замер на supply-klm после фикса: existing-wrong avg 53 мс, unknown-user avg 52 мс — паритет; до фикса разница была >40 мс.

**How to apply:** для горизонтального масштабирования (>1 инстанс) переехать на Redis-каунтер с тем же ключом. dummy-хеш всё равно остаётся.
