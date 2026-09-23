SELECT column_name, data_type, udt_name
FROM information_schema.columns 
WHERE table_name = 'lip_batch' 
ORDER BY ordinal_position;
