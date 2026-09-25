import re

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the INSERT statement in pgAddAlias
old_insert = "INSERT INTO sku_alias (sku_id, alias, source)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'}, ${userId || null})"
new_insert = "INSERT INTO sku_alias (sku_id, alias, source, created_by)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'}, ${userId || null})"

content = content.replace(old_insert, new_insert)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed INSERT statement')
