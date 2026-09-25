import json
import urllib.request

url = 'http://localhost:3001/api/stock/live'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print('Items with negative available:')
for item in data:
    if item.get('available', 0) < 0:
        print(f'  {item["raw_uid"]}: {item["name"]}')
        print(f'    base={item["base"]} consumed={item["consumed"]} available={item["available"]}')
        print(f'    plant_qty={item["plant_qty"]} lip_qty={item["lip_qty"]} inbound_qty={item["inbound_qty"]}')
        print()

print('\nAll signals:')
signals = {}
for item in data:
    s = item.get('signal', 'none')
    signals[s] = signals.get(s, 0) + 1
for s, count in sorted(signals.items()):
    print(f'  {s}: {count}')
