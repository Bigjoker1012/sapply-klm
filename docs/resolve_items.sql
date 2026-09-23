UPDATE unresolved_item 
SET resolved = true, resolved_by = 1, resolved_at = now() 
WHERE text IN ('Активо', 'Моносульфер 30%') AND resolved = false;
