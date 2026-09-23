SELECT recipe_uid, code, name, batch_t, base_batch_kg, status, created_at
FROM recipe 
WHERE created_at > '2026-09-22T08:30:00' 
ORDER BY created_at DESC 
LIMIT 5;
