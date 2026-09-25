import re

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix merge VALUES clause
old_merge = "VALUES (${targetId}, ${sourceName}, ${targetUid}, 'merge')"
new_merge = "VALUES (${targetId}, ${sourceName}, 'merge')"

content = content.replace(old_merge, new_merge)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed all VALUES clauses')
