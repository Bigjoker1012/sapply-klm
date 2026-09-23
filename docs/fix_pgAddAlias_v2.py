import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the entire pgAddAlias function
old_function_start = "export async function pgAddAlias(rawUid: string, alias: string, source: string) {"
old_function_end = "}"

# Find the function
start_idx = content.find(old_function_start)
if start_idx == -1:
    print("ERROR: Could not find pgAddAlias function")
    sys.exit(1)

# Find the end of the function (next closing brace at the same indentation level)
brace_count = 0
end_idx = start_idx
for i in range(start_idx, len(content)):
    if content[i] == '{':
        brace_count += 1
    elif content[i] == '}':
        brace_count -= 1
        if brace_count == 0:
            end_idx = i + 1
            break

old_function = content[start_idx:end_idx]

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

# Replace the function
content = content.replace(old_function, new_function)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgAddAlias function with duplicate check and user tracking')
