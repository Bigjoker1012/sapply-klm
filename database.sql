-- SAPPLY-KLM | База данных
-- Запуск: sudo -u postgres psql < database.sql

CREATE DATABASE erp_supply;
\c erp_supply;

-- Пользователи
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Справочник сырья
CREATE TABLE raw_materials (
  id SERIAL PRIMARY KEY,
  uid VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  avg_monthly_consumption DECIMAL(12,3),
  purchase_threshold DECIMAL(12,3),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Синонимы сырья
CREATE TABLE material_synonyms (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES raw_materials(id) ON DELETE CASCADE,
  synonym VARCHAR(255) NOT NULL,
  source VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(raw_material_id, synonym)
);

-- Очередь нераспознанных строк
CREATE TABLE unmatched_queue (
  id SERIAL PRIMARY KEY,
  original_text VARCHAR(500) NOT NULL,
  source_type VARCHAR(100),
  file_name VARCHAR(255),
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(original_text)
);

-- Остатки Полоцк КХП
CREATE TABLE polotsk_stock (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES raw_materials(id),
  quantity DECIMAL(12,3) NOT NULL,
  date DATE NOT NULL,
  source_file VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Остатки Липковская
CREATE TABLE lipkovskaya_stock (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES raw_materials(id),
  total_quantity DECIMAL(12,3),
  reserve DECIMAL(12,3) DEFAULT 0,
  free_quantity DECIMAL(12,3),
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Сырьё в пути
CREATE TABLE in_transit (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES raw_materials(id),
  quantity DECIMAL(12,3) NOT NULL,
  eta DATE NOT NULL,
  direction VARCHAR(100),
  status VARCHAR(50) DEFAULT 'ожидается',
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Рецепты (шапка)
CREATE TABLE recipes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100),
  concentration VARCHAR(20),
  output_quantity DECIMAL(12,3) DEFAULT 1000,
  date DATE NOT NULL,
  file_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Строки рецептов
CREATE TABLE recipe_lines (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  raw_material_id INTEGER REFERENCES raw_materials(id),
  percentage DECIMAL(10,4),
  quantity_per_ton DECIMAL(12,3),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Плановая потребность
CREATE TABLE need (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES raw_materials(id),
  planned_requirement DECIMAL(12,3),
  period VARCHAR(50),
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы
CREATE INDEX idx_polotsk_raw ON polotsk_stock(raw_material_id);
CREATE INDEX idx_polotsk_date ON polotsk_stock(date);
CREATE INDEX idx_lipkovskaya_raw ON lipkovskaya_stock(raw_material_id);
CREATE INDEX idx_lipkovskaya_date ON lipkovskaya_stock(date);
CREATE INDEX idx_transit_raw ON in_transit(raw_material_id);
CREATE INDEX idx_transit_status ON in_transit(status);
CREATE INDEX idx_synonyms_raw ON material_synonyms(raw_material_id);
CREATE INDEX idx_unmatched_resolved ON unmatched_queue(resolved);

-- ===== ТЕСТОВЫЕ ДАННЫЕ =====
INSERT INTO raw_materials (uid, name, avg_monthly_consumption, purchase_threshold) VALUES
('RAW_001', 'Витамин А 1000', 90.47, 200),
('RAW_002', 'Витамин Д3 500', 36.55, 100),
('RAW_003', 'Мел', 32457.14, 50000),
('RAW_004', 'Сода (E500)', 217.48, 300);

INSERT INTO need (raw_material_id, planned_requirement, period, date) VALUES
(1, 500, 'month', CURRENT_DATE),
(2, 200, 'month', CURRENT_DATE),
(3, 80000, 'month', CURRENT_DATE),
(4, 400, 'month', CURRENT_DATE);

INSERT INTO polotsk_stock (raw_material_id, quantity, date, source_file) VALUES
(1, 111.6, CURRENT_DATE, 'test_data'),
(2, 46.8, CURRENT_DATE, 'test_data'),
(3, 14500, CURRENT_DATE, 'test_data'),
(4, 349.5, CURRENT_DATE, 'test_data');

INSERT INTO lipkovskaya_stock (raw_material_id, total_quantity, reserve, free_quantity, date) VALUES
(1, 0, 0, 0, CURRENT_DATE),
(2, 200, 0, 200, CURRENT_DATE),
(3, 30000, 0, 30000, CURRENT_DATE),
(4, 0, 0, 0, CURRENT_DATE);

INSERT INTO in_transit (raw_material_id, quantity, eta, direction, status) VALUES
(1, 500, CURRENT_DATE + interval '6 days', 'Полоцк', 'ожидается');
