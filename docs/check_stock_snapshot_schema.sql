SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'stock_snapshot' 
ORDER BY ordinal_position;
