import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the INSERT statement in pgUpdateRecipeTons
old_insert = """        INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
        VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, ${new Date().toISOString()})"""

new_insert = """        INSERT INTO need (recipe_id, sku_id, period, gross_qty, adjustment, net_qty, version, created_at)
        VALUES (${recipeId}, ${(item as any).sku_id}, ${period}, ${(item as any).consumption_kg}, 0, ${(item as any).consumption_kg}, 1, ${new Date().toISOString()})"""

content = content.replace(old_insert, new_insert)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed need INSERT statement')
