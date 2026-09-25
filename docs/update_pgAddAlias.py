import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Old pgAddAlias function
old_function = '''export async function pgAddAlias(rawUid: string, alias: string, source: string) {
  const skuResult = await db.execute(sql\`SELECT id FROM sku WHERE code = \${rawUid}\`);
  if (skuResult.rows.length === 0) throw new Error('SKU not found: ' + rawUid);
  const skuId = (skuResult.rows[0] as any).id;
  await db.execute(sql\`
    INSERT INTO sku_alias (sku_id, alias, source)
    VALUES (\${skuId}, \${alias}, \${source || 'manual'})
    ON CONFLICT DO NOTHING
  \`);
}'''

# New pgAddAlias function with duplicate check and user tracking
new_function = '''export async function pgAddAlias(rawUid: string, alias: string, source: string, userId?: number) {
  const skuResult = await db.execute(sql\`SELECT id FROM sku WHERE code = \${rawUid}\`);
  if (skuResult.rows.length === 0) throw new Error('SKU not found: ' + rawUid);
  const skuId = (skuResult.rows[0] as any).id;
  
  // Check if alias already exists (case-insensitive)
  const existing = await db.execute(sql\`
    SELECT id, sku_id FROM sku_alias WHERE LOWER(alias) = LOWER(\${alias})
  \`);
  if (existing.rows.length > 0) {
    const existingRow = existing.rows[0] as any;
    if (existingRow.sku_id === skuId) {
      // Already linked to this SKU - OK
      return { ok: true, message: 'Вариант уже существует' };
    } else {
      // Linked to different SKU - error
      throw new Error('Такой вариант написания уже используется для другого сырья');
    }
  }
  
  await db.execute(sql\`
    INSERT INTO sku_alias (sku_id, alias, source, created_by)
    VALUES (\${skuId}, \${alias}, \${source || 'manual'}, \${userId || null})
  \`);
  return { ok: true, message: 'Вариант добавлен' };
}'''

# Apply replacement
content = content.replace(old_function, new_function)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated pgAddAlias with duplicate check and user tracking')
