SELECT id, text, source_type, file_name, qty
FROM unresolved_item 
WHERE resolved = false 
ORDER BY created_at DESC 
LIMIT 10;
