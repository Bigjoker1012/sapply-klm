SELECT recipe_uid, code, name, batch_t, base_batch_kg, status, created_at
FROM recipe 
WHERE code LIKE '%229%' OR code LIKE '%223%'
ORDER BY created_at DESC
LIMIT 10;
