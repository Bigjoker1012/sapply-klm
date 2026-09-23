import json, urllib.request

# Get the raw data from the dashboard API
req = urllib.request.Request('http://localhost:3001/api/dashboard/all')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

print("=== Recipes list (first 10) ===")
for r in data.get('recipes', [])[:10]:
    print(f"  {r}")

print("\n=== Decisions with need > 0 and status issues ===")
for d in data['decisions']:
    if d['raw_uid'] in ('RAW_021', 'RAW_013'):
        print(f"\n{d['raw_uid']} ({d['name']}):")
        print(json.dumps(d, indent=2, ensure_ascii=False))
