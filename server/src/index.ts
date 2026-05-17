import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Загружаем переменные окружения из .env файла
dotenv.config();

const app = express();
// Railway сам выдает порт через process.env.PORT, если его нет — берем 8080
const PORT = process.env.PORT || 8080;

// Настройка подключения к базе данных PostgreSQL
// Railway автоматически предоставляет переменную DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Проверка подключения к базе данных
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Ошибка подключения к PostgreSQL:', err.stack);
  }
  console.log('✅ Успешно подключено к PostgreSQL');
  release();
});

// Основные мидлвары
app.use(cors());
app.use(express.json());

// ==========================================
// ТВОИ API ЭНДПОИНТЫ (Бизнес-логика)
// ==========================================

// Пример базового пинга для проверки работоспособности
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Сервер работает отлично!' });
});

// TODO: Сюда ты можешь вставить/перенести свои эндпоинты, например:
// app.get('/api/dashboard/decisions', ...)
// app.post('/api/upload/polotsk', ...)
// app.get('/api/raw-materials', ...)


// ==========================================
// РАЗДАЧА СТАТИКИ И ФРОНТЕНДА (REACT)
// ==========================================

// Путь к собранному фронтенду в папке dist/client
// Так как сервер запускается из dist/server/src/index.js, поднимаемся на 3 уровня вверх
const frontendPath = path.join(__dirname, '../../../dist/client');

// Раздаем статические файлы (JS, CSS, картинки)
app.use(express.static(frontendPath));

// КРИТИЧЕСКИ ВАЖНО: Роут-заглушка для React Router.
// Любые запросы, которые не начинаются с /api, отправляем на index.html фронтенда.
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) {
      res.status(500).send(`
        <h3>Упс! Кажется, фронтенд еще не собрался или лежит не в той папке.</h3>
        <p>Искал тут: <code>${frontendPath}</code></p>
        <p>Убедись, что выполнилась команда сборки фронтенда.</p>
      `);
    }
  });
});

// Запуск нашего сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT} [production]`);
});
```
eof

### Что тебе теперь нужно сделать:

1. **Замени содержимое файлов у себя:**
   * Открой файл `client/vite.config.ts` в своем проекте, сотри всё, что там есть, и вставь код из первого блока выше.
   * Открой файл `server/src/index.ts`, сотри всё и вставь код из второго блока выше. *(Если у тебя там уже была написана какая-то важная бизнес-логика, просто скопируй её и вставь в отмеченное место `// ТВОИ API ЭНДПОИНТЫ`)*.

2. **Закоммить и отправь изменения:**
   Сделай привычные команды в терминале:
   ```bash
   git add .
   git commit -m "fix: настроил раздачу статики фронтенда"
   git push
