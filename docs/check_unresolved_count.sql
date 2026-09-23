SELECT COUNT(*) as total, 
       SUM(CASE WHEN resolved = true THEN 1 ELSE 0 END) as resolved,
       SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) as unresolved
FROM unresolved_item;
