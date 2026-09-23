SELECT COUNT(*) as total_batches, SUM(qty_kg) as total_kg
FROM lip_batch 
WHERE snapshot_date = CURRENT_DATE::text;
