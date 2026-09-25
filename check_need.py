import json, urllib.request

# Get dashboard data
req = urllib.request.Request('http://localhost:3001/api/dashboard/all')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

# Find RAW_021 and RAW_013 in decisions
for d in data['decisions']:
    if d['raw_uid'] in ('RAW_021', 'RAW_013'):
        print(f"\n{d['raw_uid']} ({d['name']}):")
        print(f"  plant_qty={d['plant_qty']}, lip_qty={d['lip_qty']}, inbound_qty={d['inbound_qty']}")
        print(f"  available_total={d['available_total']}")
        print(f"  planned_need={d['planned_need']}")
        print(f"  expected_after_plan={d['expected_after_plan']}")
        print(f"  cover_by_purchase={d['cover_by_purchase']}")
        print(f"  status={d['status']}")

# Check what's in Need sheet - we need to check recipes
print("\n\n=== Checking recipes that consume these materials ===")
# The Need sheet has: A=recipe_uid, B=raw_uid, C-H=various fields
# We need to check which recipes have RAW_021 and RAW_013 in their Need
