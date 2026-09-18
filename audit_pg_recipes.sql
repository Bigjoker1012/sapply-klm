-- Check PG recipe codes
SELECT id, recipe_uid, code, name FROM recipe WHERE code LIKE 'Д-%' LIMIT 20;
