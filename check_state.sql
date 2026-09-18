SELECT 'recipe_item' as entity, count(*) as pg_rows FROM recipe_item UNION ALL
SELECT 'need', count(*) FROM need UNION ALL
SELECT 'recipe', count(*) FROM recipe UNION ALL
SELECT 'batch', count(*) FROM batch;
