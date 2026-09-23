import re

# Read the file
with open('/opt/sapply-klm/client/src/pages/stock/RecipesTab.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add date converter function after imports
date_converter = """
/** Конвертирует Excel serial date в строку DD.MM.YYYY */
function excelDateToDDMMYYYY(serial: string | number | null | undefined): string {
  if (!serial) return '—';
  const s = String(serial).trim();
  // Если уже в формате DD.MM.YYYY или похожем — возвращаем как есть
  if (/^\\d{2}\\.\\d{2}\\.\\d{4}/.test(s) || /^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s;
  // Проверяем Excel serial (40000-60000 = даты 2009-2064)
  const num = Number(s);
  if (Number.isFinite(num) && num >= 30000 && num <= 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }
  return s;
}

"""

# Add after the imports
content = content.replace(
    "import { Recipe, fmt, STATUS_STYLE } from './types';",
    "import { Recipe, fmt, STATUS_STYLE } from './types';\n" + date_converter
)

# Update date display
content = content.replace(
    "<td className=\"px-3 py-1.5 text-gray-400\">{r.date || '—'}</td>",
    "<td className=\"px-3 py-1.5 text-gray-400\">{excelDateToDDMMYYYY(r.date)}</td>"
)

# Update date sorting
content = content.replace(
    "const da = a.date || '';\n    const db = b.date || '';",
    "const da = excelDateToDDMMYYYY(a.date);\n    const db = excelDateToDDMMYYYY(b.date);"
)

# Write back
with open('/opt/sapply-klm/client/src/pages/stock/RecipesTab.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added date converter to RecipesTab')
