SELECT id, recipe_uid, code, active_from, batch_t, status 
FROM recipe 
WHERE active_from IS NOT NULL 
ORDER BY id 
LIMIT 20;
