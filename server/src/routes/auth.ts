import { Router, Request, Response } from "express";

const router = Router();

// Упрощённая аутентификация без БД — используем хардкод для MVP
const USERS: Record<string, { password: string; role: string; name: string }> = {
  "admin@klm.by": { password: "klm2026", role: "Р", name: "Руководитель" },
  "kp@klm.by":    { password: "klm2026", role: "КП", name: "Кладовщик" },
  "sz@klm.by":    { password: "klm2026", role: "СЗ", name: "Специалист по закупкам" },
  "t@klm.by":     { password: "klm2026", role: "Т", name: "Технолог" },
};

router.post("/login", (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = USERS[email?.toLowerCase()];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Неверный email или пароль" });
  }
  res.json({ token: `mock-token-${email}`, user: { email, role: user.role, name: user.name } });
});

router.post("/register", (_req: Request, res: Response) => {
  res.status(400).json({ error: "Регистрация отключена. Обратитесь к администратору." });
});

export default router;
