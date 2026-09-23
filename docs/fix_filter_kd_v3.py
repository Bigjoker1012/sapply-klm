import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix import
content = content.replace(
    'import { sql } from "drizzle-orm";',
    'import { sql, inArray } from "drizzle-orm";'
)

# Fix the query - db.select() returns array directly, not {rows: []}
old_code = """      const skuIds = payload.map((p: any) => p.sku_id);
      const skuTable = require("../db/schema").sku;
      const skuNames = await db.select({ id: skuTable.id, name: skuTable.name }).from(skuTable).where(inArray(skuTable.id, skuIds));
      for (const r of skuNames.rows as any[]) refTexts.push(String(r.name || ""));"""

new_code = """      const skuIds = payload.map((p: any) => p.sku_id);
      const skuTable = require("../db/schema").sku;
      const skuNames = await db.select({ id: skuTable.id, name: skuTable.name }).from(skuTable).where(inArray(skuTable.id, skuIds));
      for (const r of skuNames as any[]) refTexts.push(String(r.name || ""));"""

content = content.replace(old_code, new_code)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgFilterKdSimilar query')
