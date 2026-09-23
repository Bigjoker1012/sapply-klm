import json, urllib.request, sys
sys.path.insert(0, '/opt/sapply-klm')

# Read Google Sheets directly
import os
os.chdir('/opt/sapply-klm')
from dotenv import load_dotenv
load_dotenv()

# We need to check the Need sheet for RAW_021 and RAW_013
# Need sheet: A=recipe_uid, B=raw_uid, C-H=fields
# Let's use the sheets API directly

import google.oauth2.service_account as gsc
import googleapiclient.discovery as gapi

creds_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
sheet_id = os.environ.get('GOOGLE_SHEET_ID')

creds = gsc.Credentials.from_service_account_info(
    json.loads(creds_json),
    scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
)
service = gapi.build('sheets', 'v4', credentials=creds)

# Read Need sheet
result = service.spreadsheets().values().get(
    spreadsheetId=sheet_id,
    range='Need!A2:H5000'
).execute()
need_rows = result.get('values', [])

# Read Recipes sheet to get recipe names and statuses
result2 = service.spreadsheets().values().get(
    spreadsheetId=sheet_id,
    range='Recipes!A2:M5000'
).execute()
recipe_rows = result2.get('values', [])

# Build recipe info map
recipe_info = {}
for r in recipe_rows:
    if r[0]:
        recipe_info[r[0]] = {
            'code': r[1] if len(r) > 1 else '',
            'name': r[2] if len(r) > 2 else '',
            'status': r[11] if len(r) > 11 else '',
            'batch_t': r[6] if len(r) > 6 else '',
        }

# Find all Need entries for RAW_021 and RAW_013
targets = {'RAW_021', 'RAW_013'}
for target in targets:
    print(f"\n=== {target} ===")
    total = 0
    for r in need_rows:
        if len(r) > 2 and r[2] == target:
            recipe_uid = r[0] if r[0] else '?'
            qty = float(r[6].replace(',', '.')) if len(r) > 6 and r[6] else 0
            info = recipe_info.get(recipe_uid, {})
            status = info.get('status', '?')
            code = info.get('code', '?')
            name = info.get('name', '?')
            batch_t = info.get('batch_t', '?')
            print(f"  recipe={recipe_uid[:12]}.. code={code} name={name[:30]} status={status} batch_t={batch_t} qty={qty}")
            total += qty
    print(f"  TOTAL: {total}")
