SELECT uj.id, uj.filename, uj.status, uj.rows_total, uj.rows_matched, uj.rows_unmatched, uj.uploaded_at
FROM upload_job uj
WHERE uj.filename LIKE '%мбарка%'
ORDER BY uj.uploaded_at DESC
LIMIT 5;
