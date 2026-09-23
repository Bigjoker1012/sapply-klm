import sys

# Read the file
with open('/opt/sapply-klm/client/src/pages/Dashboard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all occurrences of original_text with text
content = content.replace('original_text', 'text')

# Write back
with open('/opt/sapply-klm/client/src/pages/Dashboard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed: original_text -> text')
