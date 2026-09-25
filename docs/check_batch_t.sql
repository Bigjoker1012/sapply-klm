SELECT recipe_uid, code, name, batch_t, base_batch_kg 
FROM recipe 
WHERE batch_t > 0 OR base_batch_kg != 1000
LIMIT 20;
