import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix pgWriteNeedFromRecipe
old_insert = """    await db.execute(sql`
      INSERT INTO need (recipe_id, sku_id, period, net_qty, deducted, net_remaining, calculated_at)
      VALUES (${recipeId}, ${skuId}, ${period}, ${line.net_qty}, 0, ${line.net_qty}, ${new Date().toISOString()})
    `);"""

new_insert = """    await db.execute(sql`
      INSERT INTO need (recipe_id, sku_id, period, gross_qty, adjustment, net_qty, version, created_at)
      VALUES (${recipeId}, ${skuId}, ${period}, ${line.net_qty}, 0, ${line.net_qty}, 1, ${new Date().toISOString()})
    `);"""

content = content.replace(old_insert, new_insert)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgWriteNeedFromRecipe INSERT statement')
