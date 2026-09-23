import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the query to use require() for schema
old_code = """      const skuIds = payload.map((p: any) => p.sku_id);
      const skuNames = await db.select({ id: sku.id, name: sku.name }).from(sku).where(inArray(sku.id, skuIds));"""

new_code = """      const skuIds = payload.map((p: any) => p.sku_id);
      const skuTable = require("../db/schema").sku;
      const skuNames = await db.select({ id: skuTable.id, name: skuTable.name }).from(skuTable).where(inArray(skuTable.id, skuIds));"""

content = content.replace(old_code, new_code)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgFilterKdSimilar query with require()')
