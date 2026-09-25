import json
import urllib.request

url = 'http://localhost:3001/api/dashboard/decisions'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print(f'Total decisions: {len(data)}')

statuses = {}
for item in data:
    s = item.get('status', 'none')
    statuses[s] = statuses.get(s, 0) + 1

print('\nStatus distribution:')
for s, count in sorted(statuses.items()):
    print(f'  {s}: {count}')

print('\nItems with "Срочно к закупке":')
urgent_items = [x for x in data if x.get('status') == 'Срочно к закупке']
print(f'  Count: {len(urgent_items)}')
for item in urgent_items[:10]:
    print(f'  {item["raw_uid"]}: {item["name"]}')
    print(f'    available_total={item["available_total"]} avg_monthly_usage={item["avg_monthly_usage"]}')
    print(f'    planned_need={item["planned_need"]} expected_after_plan={item["expected_after_plan"]}')
    print()

print('\nItems with "К закупке":')
buy_items = [x for x in data if x.get('status') == 'К закупке']
print(f'  Count: {len(buy_items)}')
for item in buy_items[:10]:
    print(f'  {item["raw_uid"]}: {item["name"]}')
    print(f'    available_total={item["available_total"]} avg_monthly_usage={item["avg_monthly_usage"]}')
    print(f'    planned_need={item["planned_need"]} expected_after_plan={item["expected_after_plan"]}')
    print()
