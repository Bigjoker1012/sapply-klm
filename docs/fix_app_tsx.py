import sys

with open('/opt/sapply-klm/client/src/App.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Remove lines with literal \n and duplicate buttons
cleaned = []
skip_next = False
for i, line in enumerate(lines):
    if '\\n' in line and 'Диагност' in line:
        continue
    if skip_next:
        skip_next = False
        continue
    cleaned.append(line)

with open('/opt/sapply-klm/client/src/App.tsx', 'w', encoding='utf-8') as f:
    f.writelines(cleaned)

print('Fixed App.tsx')
