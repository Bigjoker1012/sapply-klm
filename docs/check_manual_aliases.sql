SELECT COUNT(*) as total_aliases, 
       SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) as manual_aliases,
       SUM(CASE WHEN source = 'auto' THEN 1 ELSE 0 END) as auto_aliases
FROM sku_alias;
