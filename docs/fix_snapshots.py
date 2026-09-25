import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the pgGetStockSnapshots function
old_function = """export async function pgGetStockSnapshots(warehouse: string): Promise<any[]> {
  const whCode = warehouse.toLowerCase().includes('липков') ? 'LIPKOV' : 'POLOTSK';
  const whResult = await db.execute(sql`SELECT id FROM warehouse WHERE code = ${whCode}`);
  if (whResult.rows.length === 0) return [];
  const whId = (whResult.rows[0] as any).id;

  const result = await db.execute(sql`
    SELECT snapshot_date, source, payload_json
    FROM stock_snapshot
    WHERE warehouse_id = ${whId}
    ORDER BY snapshot_date DESC
  `);
  return result.rows.map((r: any) => ({
    date: r.snapshot_date,
    source: r.source,
    items: Array.isArray(r.payload_json) ? r.payload_json.length : 0,
  }));
}"""

new_function = """export async function pgGetStockSnapshots(warehouse: string): Promise<any[]> {
  const whCode = warehouse.toLowerCase().includes('липков') ? 'LIPKOV' : 'POLOTSK';
  const sheet = whCode === 'LIPKOV' ? 'LipStock' : 'PlantStock';
  const whResult = await db.execute(sql`SELECT id FROM warehouse WHERE code = ${whCode}`);
  if (whResult.rows.length === 0) return [];
  const whId = (whResult.rows[0] as any).id;

  const result = await db.execute(sql`
    SELECT snapshot_date, source, payload_json
    FROM stock_snapshot
    WHERE warehouse_id = ${whId}
    ORDER BY snapshot_date DESC
  `);
  return result.rows.map((r: any) => {
    const payload = Array.isArray(r.payload_json) ? r.payload_json : [];
    const qty = payload.reduce((sum: number, item: any) => sum + (Number(item.qty_kg) || 0), 0);
    return {
      sheet,
      date: r.snapshot_date,
      rows: payload.length,
      qty: Math.round((qty + Number.EPSILON) * 100) / 100,
      source: r.source || '',
    };
  });
}"""

content = content.replace(old_function, new_function)

# Write back
with open('/opt/sapply-klm/server/src/services/postgresSupplyService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed pgGetStockSnapshots to return sheet, rows, qty')
