import json
import sys
import time
import requests

# Read credentials from .env file
env_file = '/opt/sapply-klm/.env'
with open(env_file, 'r') as f:
    env_lines = f.readlines()

env_dict = {}
for line in env_lines:
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        key, value = line.split('=', 1)
        env_dict[key.strip()] = value.strip()

creds_json = env_dict.get('GOOGLE_SERVICE_ACCOUNT_JSON')
sheet_id = env_dict.get('GOOGLE_SHEET_ID')

if not creds_json or not sheet_id:
    print("ERROR: Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID in .env")
    sys.exit(1)

creds_dict = json.loads(creds_json)

# Get access token using JWT
import jwt

now = int(time.time())
payload = {
    'iss': creds_dict['client_email'],
    'scope': 'https://www.googleapis.com/auth/spreadsheets.readonly',
    'aud': 'https://oauth2.googleapis.com/token',
    'exp': now + 3600,
    'iat': now
}

token = jwt.encode(payload, creds_dict['private_key'], algorithm='RS256')

# Get access token
token_response = requests.post('https://oauth2.googleapis.com/token', data={
    'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion': token
})

if token_response.status_code != 200:
    print(f"ERROR getting token: {token_response.text}")
    sys.exit(1)

access_token = token_response.json()['access_token']

# Read Recipes sheet
url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Recipes!A2:M50'
headers = {'Authorization': f'Bearer {access_token}'}

response = requests.get(url, headers=headers)
if response.status_code != 200:
    print(f"ERROR reading sheet: {response.text}")
    sys.exit(1)

data = response.json()
rows = data.get('values', [])

print(f"Found {len(rows)} recipe rows")
print("\nFirst 10 rows (columns A-M):")
print("A=uid, B=code, C=name, D=premix, E=date, F=conc, G=batch_t, H=customer, I=period, J=quarter, K=file, L=status, M=base_batch_kg")
print("-" * 100)

for i, row in enumerate(rows[:10]):
    # Pad row to 13 columns
    while len(row) < 13:
        row.append('')
    print(f"Row {i+2}: {row[0][:20]:20} | {row[1][:15]:15} | G={row[6]:8} | L={row[11]:10} | M={row[12]:8}")

# Count batch_t values
batch_t_values = []
for row in rows:
    while len(row) < 13:
        row.append('')
    try:
        bt = float(row[6]) if row[6] else 0
        batch_t_values.append(bt)
    except:
        batch_t_values.append(0)

print(f"\nbatch_t statistics:")
print(f"  Total rows: {len(batch_t_values)}")
print(f"  batch_t > 0: {sum(1 for v in batch_t_values if v > 0)}")
print(f"  batch_t = 0: {sum(1 for v in batch_t_values if v == 0)}")
print(f"  batch_t empty: {sum(1 for v in batch_t_values if v == 0)}")
