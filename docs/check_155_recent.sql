SELECT recipe_uid, code, name, batch_t, base_batch_kg, status, created_at
FROM recipe 
WHERE code LIKE '%155%' AND created_at > '2026-09-22T08:00:00'
ORDER BY created_at DESC 
LIMIT 5;
