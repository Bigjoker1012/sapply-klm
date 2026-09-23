import json
import urllib.request

url = 'http://localhost:3001/api/planning'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print('=== RAW_071 Буструм AFTER FIX ===')
for item in data:
    if item['raw_uid'] == 'RAW_071':
        print(f'  status: {item["status"]}')
        print(f'  need_ratio: {item["need_ratio"]}')
        print(f'  final: {item["final"]}')
        print(f'  avg_monthly_usage: {item["avg_monthly_usage"]}')
        print(f'  qty_today: {item["qty_today"]}')
        break

print('\n=== All orphan items AFTER FIX ===')
orphans = ['RAW_071', 'RAW_073', 'RAW_007', 'RAW_008', 'RAW_038', 'RAW_018', 'RAW_048', 'RAW_049', 'RAW_041', 'RAW_043']
for item in data:
    if item['raw_uid'] in orphans:
        print(f'  {item["raw_uid"]}: {item["name"]} status={item["status"]}')

print('\n=== Status distribution AFTER FIX ===')
statuses = {}
for item in data:
    s = item.get('status', 'none')
    statuses[s] = statuses.get(s, 0) + 1
for s, count in sorted(statuses.items()):
    print(f'  {s}: {count}')
