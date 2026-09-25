path = '/opt/sapply-klm/client/src/App.tsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix: add Diagnost conditional render after Expiry
old = "{tab === 'expiry' && <Expiry onBack={goHome} />}"
new = "{tab === 'expiry' && <Expiry onBack={goHome} />}\n        {tab === 'diagnost' && <Diagnost onBack={goHome} />}"

# Remove any broken escaped version first
content = content.replace("{tab === 'diagnost' \\&\\& <Diagnost onBack={goHome} />}", "")
content = content.replace("{tab === 'diagnost' && <Diagnost onBack={goHome} />}", "")

# Add it properly after expiry
content = content.replace(old, old + "\n        {tab === 'diagnost' && <Diagnost onBack={goHome} />}")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')
