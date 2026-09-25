import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the VALUES clause
old_values = "VALUES (${skuId}, ${alias}, ${rawUid}, ${source || 'manual'})"
new_values = "VALUES (${skuId}, ${alias}, ${source || 'manual'})"

content = content.replace(old_values, new_values)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgAddAlias VALUES clause')
