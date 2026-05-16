import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ПОДКЛЮЧЕНИЕ К БАЗЕ - ИСПРАВЛЕННАЯ ВЕРСИЯ
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL не найдена в переменных окружения!');
    process.exit(1);
}

console.log('📡 Попытка подключения к PostgreSQL...');

export const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// Проверка подключения
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ DB error:', err.message);
        console.error('DATABASE_URL:', connectionString.substring(0, 30) + '...');
    } else {
        console.log('✅ Connected to PostgreSQL');
        release();
    }
});

// API маршруты
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/decisions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                rm.uid as "код сырья",
                rm.name as "наименование",
                COALESCE(ps.quantity, 0) as "остаток Полоцк",
                COALESCE(ls.free_quantity, 0) as "свободно Липковская",
                COALESCE(it.quantity, 0) as "в пути",
                COALESCE(n.planned_requirement, 0) as "плановая потребность",
                CASE 
                    WHEN COALESCE(ps.quantity, 0) + COALESCE(ls.free_quantity, 0) + COALESCE(it.quantity, 0) < COALESCE(n.planned_requirement, 0) 
                    THEN 'СРОЧНО ЗАКУПАТЬ'
                    ELSE 'В НОРМЕ'
                END as "статус",
                GREATEST(0, COALESCE(n.planned_requirement, 0) - COALESCE(ps.quantity, 0) - COALESCE(ls.free_quantity, 0) - COALESCE(it.quantity, 0)) as "закупка"
            FROM raw_materials rm
            LEFT JOIN polotsk_stock ps ON rm.id = ps.raw_material_id AND ps.date = CURRENT_DATE
            LEFT JOIN lipkovskaya_stock ls ON rm.id = ls.raw_material_id AND ls.date = CURRENT_DATE
            LEFT JOIN in_transit it ON rm.id = it.raw_material_id
            LEFT JOIN need n ON rm.id = n.raw_material_id AND n.date = CURRENT_DATE
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Query error:', error);
        res.status(500).json({ error: 'Database query error' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
