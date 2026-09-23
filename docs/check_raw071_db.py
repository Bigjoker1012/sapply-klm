import psycopg2

conn = psycopg2.connect(host='localhost', database='erp_supply', user='postgres', password='internal_supply_2026')
cur = conn.cursor()

# Check purchase_plan_setting for RAW_071
cur.execute("SELECT * FROM purchase_plan_setting WHERE sku_code = 'RAW_071'")
rows = cur.fetchall()
print('=== purchase_plan_setting for RAW_071 ===')
for row in rows:
    print(row)

# Check if RAW_071 is in any recipe
cur.execute("""
    SELECT r.name, ri.consumption_kg 
    FROM recipe_item ri 
    JOIN recipe r ON ri.recipe_id = r.id 
    JOIN sku s ON ri.sku_id = s.id 
    WHERE s.code = 'RAW_071' AND r.status = 'active'
""")
rows = cur.fetchall()
print('\n=== Active recipes containing RAW_071 ===')
if rows:
    for row in rows:
        print(row)
else:
    print('NOT FOUND in any active recipe')

# Check avg_monthly_usage calculation
cur.execute("""
    SELECT s.code, s.name, pps.manual_avg_usage, pps.manual_input
    FROM sku s
    LEFT JOIN purchase_plan_setting pps ON s.code = pps.sku_code
    WHERE s.code = 'RAW_071'
""")
rows = cur.fetchall()
print('\n=== SKU + settings for RAW_071 ===')
for row in rows:
    print(row)

cur.close()
conn.close()
