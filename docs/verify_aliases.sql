SELECT sa.id, s.code, s.name, sa.alias, sa.source
FROM sku_alias sa
JOIN sku s ON sa.sku_id = s.id
WHERE sa.source = 'audit_4.11.4'
ORDER BY sa.id;
