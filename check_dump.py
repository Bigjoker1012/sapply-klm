import sys, json
d = json.load(sys.stdin)
for p in d:
    print(p.get('name', '?'), p.get('pm_id', '?'))
