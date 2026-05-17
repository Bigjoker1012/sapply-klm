import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Импортируем твои роуты
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import inTransitRoutes from './routes/inTransit';
import inventoryRoutes from './routes/inventory';
import rawMaterialsRoutes from './routes/rawMaterials';
import recipesRoutes from './routes/recipes';
import synonymsRoutes from './routes/synonyms';
import uploadRoutes from './routes/upload';

// Загружаем переменные окружения
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Настройка подключения к базе данных PostgreSQL
export const pool = new Pool({
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

// ПОДКЛЮЧАЕМ ТВОИ API РОУТЫ
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/in-transit', inTransitRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/raw-materials', rawMaterialsRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/synonyms', synonymsRoutes);
app.use('/api/upload', uploadRoutes);

// Базовый эндпоинт для проверки здоровья сервера
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// --- НАСТРОЙКА РАЗДАЧИ ФРОНТЕНДА (REACT) ---

// Используем process.cwd() — это гарантирует правильный путь к корню проекта на Railway
const frontendPath = path.join(process.cwd(), 'dist', 'client');

// Раздаем статические файлы (картинки, JS, CSS)
app.use(express.static(frontendPath));

// Для абсолютно любого запроса возвращаем именно index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) {
      console.error('Ошибка отправки index.html:', err);
      res.status(505).send('Критическая ошибка: Фронтенд не найден по пути: ' + frontendPath);
    }
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log('Server is running on port: ' + PORT);
});
