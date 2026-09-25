SELECT id, text, source_type, file_name, qty, source_warehouse, resolved, created_at
FROM unresolved_item
WHERE resolved = false
ORDER BY created_at DESC
LIMIT 20;
