import xlrd
import sys

sys.stdout.reconfigure(encoding='utf-8')

wb = xlrd.open_workbook('/opt/sapply-klm/attached_assets/КД_18_05_26_Липковская_1779190435513.xls')
ws = wb.sheet_by_index(0)
print(f'Sheet: {ws.name}')
print(f'Rows: {ws.nrows}, Cols: {ws.ncols}')
print()
print('First 15 rows:')
for r in range(min(15, ws.nrows)):
    row = []
    for c in range(min(11, ws.ncols)):
        v = ws.cell_value(r, c)
        row.append(str(v)[:30] if v else '')
    print(f'Row {r:2}: {row}')
