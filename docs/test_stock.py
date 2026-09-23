import json
import urllib.request

url = 'http://localhost:3001/api/stock/live'
with urllib.request.urlopen(url) as response:
    data = json.loads(response.read().decode())

print(f'Total items: {len(data)}')
buy_count = sum(1 for x in data if x.get('signal') == 'buy')
ok_count = sum(1 for x in data if x.get('signal') == 'ok')
excess_count = sum(1 for x in data if x.get('signal') == 'excess')
print(f'Items with signal=buy: {buy_count}')
print(f'Items with signal=ok: {ok_count}')
print(f'Items with signal=excess: {excess_count}')

raw_uids = [x['raw_uid'] for x in data]
duplicates = set([x for x in raw_uids if raw_uids.count(x) > 1])
print(f'Duplicates: {len(duplicates)}')

negative = [x for x in data if x.get('available', 0) < 0]
print(f'Negative available: {len(negative)}')

for item in data:
    base = item.get('base', 0)
    consumed = item.get('consumed', 0)
    available = item.get('available', 0)
    calc = base - consumed
    if abs(calc - available) > 0.01:
        print(f'MISMATCH: {item["name"]} base={base} consumed={consumed} available={available} expected={calc}')

print('\nSample items (first 5):')
for item in data[:5]:
    print(f'  {item["raw_uid"]}: {item["name"]} base={item["base"]} consumed={item["consumed"]} available={item["available"]} signal={item["signal"]}')
