import json
import os
import sys
import requests
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

# Read credentials from environment
creds_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
sheet_id = os.environ.get('GOOGLE_SHEET_ID')

if not creds_json or not sheet_id:
    print("ERROR: Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID")
    sys.exit(1)

creds_dict = json.loads(creds_json)
creds = Credentials.from_service_account_info(creds_dict, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
service = build('sheets', 'v4', credentials=creds)

# Read Recipes sheet (columns A-M)
result = service.spreadsheets().values().get(
    spreadsheetId=sheet_id,
    range='Recipes!A2:M50'
).execute()

rows = result.get('values', [])
print(f"Found {len(rows)} recipe rows")
print("\nFirst 10 rows (columns A-M):")
print("A=uid, B=code, C=name, D=premix, E=date, F=conc, G=batch_t, H=customer, I=period, J=quarter, K=file, L=status, M=base_batch_kg")
print("-" * 100)

for i, row in enumerate(rows[:10]):
    # Pad row to 13 columns
    while len(row) < 13:
        row.append('')
    print(f"Row {i+2}: {row[0][:20]:20} | {row[1][:15]:15} | G={row[6]:8} | L={row[11]:10} | M={row[12]:8}")
