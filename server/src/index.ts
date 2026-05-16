import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// DB pool — экспортируем для роутов
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.connect((err) => {
  if (err) console.error('❌ DB error:', err.message);
  else console.log('✅ Connected to PostgreSQL');
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// Routes
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import synonymRoutes from './routes/synonyms';
import inventoryRoutes from './routes/inventory';
import inTransitRoutes from './routes/inTransit';
import recipeRoutes from './routes/recipes';
import dashboardRoutes from './routes/dashboard';
import rawMaterialsRoutes from './routes/rawMaterials';

app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/synonyms', synonymRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/in-transit', inTransitRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/raw-materials', rawMaterialsRoutes);

// Serve React build in production
const clientBuild = path.join(__dirname, '../../../dist/client');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`🚀 Server on port ${port} [${process.env.NODE_ENV || 'development'}]`);
});
