SELECT 'sku' as entity, count(*) as pg_rows FROM sku UNION ALL
SELECT 'sku_alias', count(*) FROM sku_alias UNION ALL
SELECT 'batch', count(*) FROM batch UNION ALL
SELECT 'recipe', count(*) FROM recipe UNION ALL
SELECT 'recipe_item', count(*) FROM recipe_item UNION ALL
SELECT 'need', count(*) FROM need UNION ALL
SELECT 'stock_snapshot', count(*) FROM stock_snapshot UNION ALL
SELECT 'excluded_item', count(*) FROM excluded_item UNION ALL
SELECT 'analog', count(*) FROM analog UNION ALL
SELECT 'unresolved_item', count(*) FROM unresolved_item UNION ALL
SELECT 'document_archive', count(*) FROM document_archive UNION ALL
SELECT 'purchase_plan_setting', count(*) FROM purchase_plan_setting UNION ALL
SELECT 'user', count(*) FROM  user;
