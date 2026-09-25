SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name IN ('lip_batch', 'stock_snapshot', 'sku', 'unresolved_item')
AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR data_type LIKE '%[]')
ORDER BY table_name, column_name;
