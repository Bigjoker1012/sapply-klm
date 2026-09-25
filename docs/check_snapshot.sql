SELECT id, warehouse_id, snapshot_date, source, payload_json::text
FROM stock_snapshot
WHERE id = 204;
