import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all occurrences of the wrong INSERT
old_insert = "INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)"
new_insert = "INSERT INTO need (recipe_id, sku_id, period, gross_qty, adjustment, net_qty, version, created_at)"

content = content.replace(old_insert, new_insert)

# Fix all VALUES patterns
old_values1 = "VALUES (${recipeId}, ${skuId}, ${period}, ${line.net_qty}, 0, ${line.net_qty}, ${new Date().toISOString()})"
new_values1 = "VALUES (${recipeId}, ${skuId}, ${period}, ${line.net_qty}, 0, ${line.net_qty}, 1, ${new Date().toISOString()})"

old_values2 = "VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, ${new Date().toISOString()})"
new_values2 = "VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, 1, ${new Date().toISOString()})"

old_values3 = "VALUES (${newRecipeId}, ${(item as any).sku_id}, ${newPeriod}, ${newCons}, 0, ${newCons}, ${new Date().toISOString()})"
new_values3 = "VALUES (${newRecipeId}, ${(item as any).sku_id}, ${newPeriod}, ${newCons}, 0, ${newCons}, 1, ${new Date().toISOString()})"

content = content.replace(old_values1, new_values1)
content = content.replace(old_values2, new_values2)
content = content.replace(old_values3, new_values3)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed all need INSERT statements')
