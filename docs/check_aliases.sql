SELECT sa.id, s.code, s.name, sa.alias, sa.source, sa.created_at
FROM sku_alias sa
JOIN sku s ON sa.sku_id = s.id
ORDER BY sa.created_at DESC
LIMIT 20;
