import json, urllib.request
req = urllib.request.Request('http://localhost:3001/api/dashboard/decisions')
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())
# Find items with status "Норма" but negative expected_after_plan
print("Items with status='Норма' but deficit:")
for d in data:
    if d['status'] == 'Норма' and d['expected_after_plan'] < 0:
        print(f"  {d['raw_uid']:10} {d['name'][:40]:40} exp={d['expected_after_plan']:>10} purchase={d['cover_by_purchase']:>10}")
print()
# Show all statuses
from collections import Counter
c = Counter(d['status'] for d in data)
print("Status distribution:", dict(c))
