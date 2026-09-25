SELECT ss.id, ss.warehouse_id, ss.snapshot_date, ss.source, ss.created_at
FROM stock_snapshot ss
WHERE ss.source LIKE '%мбарка%'
ORDER BY ss.created_at DESC
LIMIT 5;
