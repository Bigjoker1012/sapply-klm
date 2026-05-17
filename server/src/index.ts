import express from 'express';
import cors from 'cors';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Импортируем роуты твоего приложения
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import inTransitRoutes from './routes/inTransit';
import inventoryRoutes from './routes/inventory';
import rawMaterialsRoutes from './routes/rawMaterials';
import recipesRoutes from './routes/recipes';
import synonymsRoutes from './routes/synonyms';
import uploadRoutes from './routes/upload';

// Загружаем настройки из .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Подключение к базе данных PostgreSQL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Проверяем коннект к БД
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error connecting to PostgreSQL:', err.stack);
  }
  console.log('Connected to PostgreSQL');
  release();
});

// Основные системные мидлвары
app.use(cors());
app.use(express.json());

// Подключаем все твои роуты к API
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/in-transit', inTransitRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/raw-materials', rawMaterialsRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/synonyms', synonymsRoutes);
app.use('/api/upload', uploadRoutes);

// Тест сервера
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// --- РАЗДАЧА СОБРАННОГО ФРОНТЕНДА ---

// Определяем путь к скомпилированному React-приложению
const frontendPath = path.resolve(__dirname, '../../../dist/client');

// Раздаем статические файлы (картинки, стили, скрипты)
app.use(express.static(frontendPath));

// Любой другой запрос отправляет пользователя на index.html (для работы React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) {
      res.status(500).send('Frontend is not found at: ' + frontendPath);
    }
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log('Server is running on port: ' + PORT);
});
