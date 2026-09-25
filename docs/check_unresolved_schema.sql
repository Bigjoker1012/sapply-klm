SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'unresolved_item' 
ORDER BY ordinal_position;
