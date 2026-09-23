import json
import urllib.request

url = 'http://localhost:3001/api/dashboard/decisions'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print('=== Dashboard AFTER FIX ===')
statuses = {}
for item in data:
    s = item.get('status', 'none')
    statuses[s] = statuses.get(s, 0) + 1
for s, count in sorted(statuses.items()):
    print(f'  {s}: {count}')

print('\n=== RAW_071 in dashboard ===')
for item in data:
    if item['raw_uid'] == 'RAW_071':
        print(f'  status: {item["status"]}')
        print(f'  available_total: {item["available_total"]}')
        print(f'  avg_monthly_usage: {item["avg_monthly_usage"]}')
        break
