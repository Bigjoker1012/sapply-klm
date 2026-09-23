import re

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Update function signature
content = content.replace(
    'export async function pgAddAlias(rawUid: string, alias: string, source: string)',
    'export async function pgAddAlias(rawUid: string, alias: string, source: string, userId?: number)'
)

# Find the line with skuId assignment
sku_id_line = "const skuId = (skuResult.rows[0] as any).id;"

# Add duplicate check after skuId line
duplicate_check = """
  
  // Check if alias already exists (case-insensitive)
  const existing = await db.execute(sql`
    SELECT id, sku_id FROM sku_alias WHERE LOWER(alias) = LOWER(${alias})
  `);
  if (existing.rows.length > 0) {
    const existingRow = existing.rows[0] as any;
    if (existingRow.sku_id === skuId) {
      return { ok: true, message: 'Вариант уже существует' };
    } else {
      throw new Error('Такой вариант написания уже используется для другого сырья');
    }
  }"""

content = content.replace(sku_id_line, sku_id_line + duplicate_check)

# Update INSERT statement to include created_by
content = content.replace(
    "INSERT INTO sku_alias (sku_id, alias, source)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'})",
    "INSERT INTO sku_alias (sku_id, alias, source, created_by)\n    VALUES (${skuId}, ${alias}, ${source || 'manual'}, ${userId || null})"
)

# Update return statement
content = content.replace(
    "ON CONFLICT DO NOTHING\n  `);\n}",
    "ON CONFLICT DO NOTHING\n  `);\n  return { ok: true, message: 'Вариант добавлен' };\n}"
)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated pgAddAlias with duplicate check and user tracking')
