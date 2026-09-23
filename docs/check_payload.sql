SELECT id, payload_json::text
FROM stock_snapshot 
WHERE warehouse_id = 1 
ORDER BY snapshot_date DESC 
LIMIT 1;
