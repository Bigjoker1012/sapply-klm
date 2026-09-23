SELECT sa.id, s.code, s.name, sa.alias, sa.source
FROM sku_alias sa
JOIN sku s ON sa.sku_id = s.id
ORDER BY sa.id DESC
LIMIT 20;
