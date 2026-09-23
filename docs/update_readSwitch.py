import sys

# Read the file
with open('/opt/sapply-klm/server/src/services/readSwitch.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Old addAlias export
old_export = "export async function addAlias(rawUid: string, alias: string, source: string) { return pgAddAlias(rawUid, alias, source); }"

# New addAlias export with userId
new_export = "export async function addAlias(rawUid: string, alias: string, source: string, userId?: number) { return pgAddAlias(rawUid, alias, source, userId); }"

# Apply replacement
content = content.replace(old_export, new_export)

# Write back
with open('/opt/sapply-klm/server/src/services/readSwitch.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated readSwitch addAlias to pass userId')
