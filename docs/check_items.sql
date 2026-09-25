SELECT ssi.id, ssi.sku_id, ssi.name_from_source, ssi.qty_kg, ssi.match_status
FROM stock_snapshot_item ssi
WHERE ssi.snapshot_id = 204
ORDER BY ssi.id;
