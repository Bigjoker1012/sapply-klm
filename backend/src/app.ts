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

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.connect((err) => {
  if (err) console.error('DB connection error:', err.message);
  else console.log('✅ Connected to PostgreSQL');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/build/index.html'));
  });
}

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
