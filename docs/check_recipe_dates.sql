SELECT id, uid, code, date, batch_t, status 
FROM recipe 
WHERE date IS NOT NULL 
ORDER BY id 
LIMIT 20;
