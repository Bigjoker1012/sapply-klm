-- ТЗ-А2: Миграция для исправления жизненного цикла рецепта
-- Дата: 2026-09-24
-- Описание: Добавление is_partial, обновление статусов, исправление точности

BEGIN;

-- 1. Добавляем колонку is_partial в таблицу recipe
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS is_partial BOOLEAN NOT NULL DEFAULT false;

-- 2. Обновляем статус cancelled для существующих отменённых рецептов
-- (ранее они были mapped в archived)
UPDATE recipe SET status = 'cancelled' 
WHERE recipe_uid LIKE '%cancelled%' OR recipe_uid LIKE '%отменён%';

-- 3. Добавляем комментарий к колонке
COMMENT ON COLUMN recipe.is_partial = 'Признак остаточной части после partial production';

-- 4. Создаём индекс для быстрой фильтрации остаточных рецептов
CREATE INDEX IF NOT EXISTS recipe_is_partial_idx ON recipe(is_partial) WHERE is_partial = true;

COMMIT;
