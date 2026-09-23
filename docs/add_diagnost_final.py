import sys

path = '/opt/sapply-klm/client/src/App.tsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import for Diagnost
if "import Diagnost" not in content:
    content = content.replace(
        "import Expiry from './pages/Expiry';",
        "import Expiry from './pages/Expiry';\nimport Diagnost from './pages/Diagnost';"
    )

# 2. Add 'diagnost' to Tab type
if "'diagnost'" not in content:
    content = content.replace(
        "type Tab = 'home' | 'stock' | 'planning' | 'synonyms' | 'analogs' | 'excluded' | 'expiry';",
        "type Tab = 'home' | 'stock' | 'planning' | 'synonyms' | 'analogs' | 'excluded' | 'expiry' | 'diagnost';"
    )

# 3. Add Diagnost button before </nav>
if "tab === 'diagnost'" not in content:
    content = content.replace(
        '        </button>\n      </nav>',
        '        </button>\n        <button className={tabCls(tab === \'diagnost\')} onClick={() => setTab(\'diagnost\')}>\n          \U0001fa78 Диагност\n        </button>\n      </nav>'
    )

# 4. Add conditional render for Diagnost
if "tab === 'diagnost'" not in content:
    content = content.replace(
        "{tab === 'expiry' && <Expiry onBack={goHome} />}",
        "{tab === 'expiry' && <Expiry onBack={goHome} />}\n        {tab === 'diagnost' && <Diagnost onBack={goHome} />}"
    )

# 5. Add onOpenDiagnost to Dashboard if needed
if 'onOpenDiagnost' not in content:
    content = content.replace(
        '<Dashboard onOpenPlanning={() => setTab(\'planning\')} onOpenExpiry={() => setTab(\'expiry\')} />',
        '<Dashboard onOpenPlanning={() => setTab(\'planning\')} onOpenExpiry={() => setTab(\'expiry\')} onOpenDiagnost={() => setTab(\'diagnost\')} />'
    )

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done - Diagnost added to App.tsx')
