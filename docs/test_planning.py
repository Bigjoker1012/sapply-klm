import json
import urllib.request

url = 'http://localhost:3001/api/planning'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print(f'Total planning items: {len(data)}')

statuses = {}
for item in data:
    s = item.get('status', 'none')
    statuses[s] = statuses.get(s, 0) + 1

print('\nStatus distribution:')
for s, count in sorted(statuses.items()):
    print(f'  {s}: {count}')

print('\nItems with status != "none" and != "ok":')
for item in data:
    if item.get('status') not in ('none', 'ok', None):
        print(f'  {item["raw_uid"]}: {item["name"]}')
        print(f'    status={item["status"]} qty_today={item["qty_today"]} planned_need={item["planned_need"]}')
        print(f'    need_ratio={item["need_ratio"]} final={item["final"]}')
        print()

print('\nItems with planned_need > 0:')
need_items = [x for x in data if x.get('planned_need', 0) > 0]
print(f'  Count: {len(need_items)}')
for item in need_items[:5]:
    print(f'  {item["raw_uid"]}: {item["name"]} planned_need={item["planned_need"]} qty_today={item["qty_today"]}')
