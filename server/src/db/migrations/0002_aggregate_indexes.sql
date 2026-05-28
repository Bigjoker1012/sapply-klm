-- Индексы под агрегаты дашборда (см. server/src/routes/dashboard.ts).
-- Каталог пока маленький (~100 SKU), но при росте без этих индексов
-- коррелированные подзапросы превращаются в full-scan.

-- Подзапрос planned_need: JOIN recipe_item ON sku_id = ?
CREATE INDEX IF NOT EXISTS recipe_item_sku_idx
  ON recipe_item(sku_id, recipe_id);

-- Тот же подзапрос: фильтр по статусу production_plan + JOIN по recipe_id
CREATE INDEX IF NOT EXISTS production_plan_recipe_status_idx
  ON production_plan(recipe_id, status);

-- loadStatus: MAX(created_at) по warehouse_id
CREATE INDEX IF NOT EXISTS stock_snapshot_wh_created_idx
  ON stock_snapshot(warehouse_id, created_at);

-- loadUnmatched / loadStatus: фильтр по action перед join на upload_job
CREATE INDEX IF NOT EXISTS upload_row_action_job_idx
  ON upload_row(action, upload_job_id);
