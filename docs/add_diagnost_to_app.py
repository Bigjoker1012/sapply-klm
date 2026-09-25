import sys

with open('/opt/sapply-klm/client/src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import
if 'Diagnost' not in content:
    content = content.replace(
        "import Excluded from './pages/Excluded';",
        "import Excluded from './pages/Excluded';\nimport Diagnost from './pages/Diagnost';"
    )

# 2. Add 'diagnost' to Tab type
if "'diagnost'" not in content:
    content = content.replace(
        "type Tab = 'home' | 'planning' | 'stock' | 'excluded' | 'synonyms' | 'analogs';",
        "type Tab = 'home' | 'planning' | 'stock' | 'excluded' | 'synonyms' | 'analogs' | 'diagnost';"
    )

# 3. Add menu button before closing nav
if 'diagnost' not in content.split('</nav>')[0]:
    content = content.replace(
        '</nav>',
        '          <button className={tabCls(tab === \'diagnost\')} onClick={() => setTab(\'diagnost\')}>\\n            🩺 Диагност\\n          </button>\\n        </nav>'
    )

# 4. Add conditional render
if "tab === 'diagnost'" not in content:
    content = content.replace(
        "{tab === 'excluded' && <Excluded onBack={goHome} />}",
        "{tab === 'excluded' && <Excluded onBack={goHome} />}\n        {tab === 'diagnost' && <Diagnost onBack={goHome} />}"
    )

with open('/opt/sapply-klm/client/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added Diagnost to App.tsx')
