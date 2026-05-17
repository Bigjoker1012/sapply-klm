import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Настройка подключения к базе данных PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Проверка подключения к базе данных
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error connecting to PostgreSQL:', err.stack);
  }
  console.log('Connected to PostgreSQL');
  release();
});

// Основные мидлвары
app.use(cors());
app.use(express.json());

// Базовый эндпоинт для проверки здоровья сервера
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// --- НАСТРОЙКА РАЗДАЧИ ФРОНТЕНДА ---

// Определяем путь к собранному фронтенду (dist/client)
// Так как сервер запускается из dist/server/src/index.js,
// поднимаемся на два уровня вверх до dist и переходим в client
const frontendPath = path.join(__dirname, '..', '..', 'client');

// Раздаем статические файлы фронтенда
app.use(express.static(frontendPath));

// Роут-заглушка для React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) {
      res.status(500).send('Frontend is building or not found at: ' + frontendPath);
    }
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log('Server is running on port: ' + PORT);
});
