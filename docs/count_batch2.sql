SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN batch_t IS NULL THEN 1 ELSE 0 END) as null_batch,
  SUM(CASE WHEN batch_t = 0 THEN 1 ELSE 0 END) as zero_batch,
  SUM(CASE WHEN batch_t > 0 THEN 1 ELSE 0 END) as has_batch
FROM recipe;
