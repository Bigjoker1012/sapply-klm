SELECT id, file_name, doc_type, uploaded_at 
FROM document_archive 
WHERE file_name LIKE '%мбарка%' 
ORDER BY uploaded_at DESC 
LIMIT 10;
