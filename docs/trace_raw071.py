import json
import urllib.request

# Get planning data
url = 'http://localhost:3001/api/planning'
with urllib.request.urlopen(url) as response:
    planning = json.loads(response.read().decode())

# Find RAW_071
for item in planning:
    if item['raw_uid'] == 'RAW_071':
        print('=== RAW_071 Буструм (from /api/planning) ===')
        for k, v in item.items():
            print(f'  {k}: {v}')
        print()

# Get dashboard decisions
url = 'http://localhost:3001/api/dashboard/decisions'
with urllib.request.urlopen(url) as response:
    decisions = json.loads(response.read().decode())

# Find RAW_071 in decisions
for item in decisions:
    if item['raw_uid'] == 'RAW_071':
        print('=== RAW_071 Буструм (from /api/dashboard/decisions) ===')
        for k, v in item.items():
            print(f'  {k}: {v}')
        print()

# Check if RAW_071 is in any recipe
url = 'http://localhost:3001/api/recipes'
with urllib.request.urlopen(url) as response:
    recipes = json.loads(response.read().decode())

print(f'=== Recipes containing RAW_071 ===')
found = False
for recipe in recipes:
    if 'items' in recipe:
        for item in recipe['items']:
            if item.get('sku_id') == 'RAW_071' or item.get('raw_uid') == 'RAW_071':
                print(f'  Recipe: {recipe.get("name", "unknown")}')
                found = True
if not found:
    print('  NOT FOUND in any recipe')
