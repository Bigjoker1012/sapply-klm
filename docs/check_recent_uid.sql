SELECT recipe_uid, code, name, batch_t, base_batch_kg, status, created_at
FROM recipe 
WHERE recipe_uid LIKE '%1790066%' 
ORDER BY created_at DESC 
LIMIT 5;
