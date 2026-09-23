import re

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Update function signature
content = content.replace(
    'export async function pgAddAlias(rawUid: string, alias: string, source: string)',
    'export async function pgAddAlias(rawUid: string, alias: string, source: string, userId?: number)'
)

# Update INSERT statement
content = content.replace(
    "INSERT INTO sku_alias (sku_id, alias, source)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'})",
    "INSERT INTO sku_alias (sku_id, alias, source, created_by)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'}, ${userId || null})"
)

# Add ON CONFLICT handling
content = content.replace(
    "ON CONFLICT DO NOTHING\n  `);\n}",
    "ON CONFLICT (alias) DO UPDATE SET source = EXCLUDED.source\n  `);\n  return { ok: true, message: 'Вариант добавлен' };\n}"
)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated pgAddAlias with simple duplicate handling')
