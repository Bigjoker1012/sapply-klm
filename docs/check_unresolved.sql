SELECT id, original_text, source_type, file_name, qty_kg, source_warehouse, resolved, created_at
FROM unresolved_item
WHERE file_name LIKE '%мбарка%'
ORDER BY created_at DESC
LIMIT 20;
