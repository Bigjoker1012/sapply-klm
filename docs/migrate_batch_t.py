import json
import sys
import time
import requests
import jwt

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

# Read ALL Recipes sheet rows
url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Recipes!A2:M5000'
headers = {'Authorization': f'Bearer {access_token}'}

response = requests.get(url, headers=headers)
if response.status_code != 200:
    print(f"ERROR reading sheet: {response.text}")
    sys.exit(1)

data = response.json()
rows = data.get('values', [])

print(f"Found {len(rows)} recipe rows in Google Sheets")

# Parse batch_t and base_batch_kg
recipes = []
for i, row in enumerate(rows):
    while len(row) < 13:
        row.append('')
    
    uid = row[0].strip()
    if not uid or not uid.startswith('REC_'):
        continue
    
    batch_t_str = row[6].replace(',', '.').strip()
    base_batch_kg_str = row[12].replace(',', '.').strip()
    
    try:
        batch_t = float(batch_t_str) if batch_t_str else 0
    except:
        batch_t = 0
    
    try:
        base_batch_kg = float(base_batch_kg_str) if base_batch_kg_str else 0
    except:
        base_batch_kg = 0
    
    recipes.append({
        'uid': uid,
        'batch_t': batch_t,
        'base_batch_kg': base_batch_kg
    })

print(f"Parsed {len(recipes)} recipes with batch_t data")
print(f"\nbatch_t statistics:")
print(f"  batch_t > 0: {sum(1 for r in recipes if r['batch_t'] > 0)}")
print(f"  batch_t = 0: {sum(1 for r in recipes if r['batch_t'] == 0)}")
print(f"\nbase_batch_kg statistics:")
print(f"  base_batch_kg > 0: {sum(1 for r in recipes if r['base_batch_kg'] > 0)}")
print(f"  base_batch_kg = 0: {sum(1 for r in recipes if r['base_batch_kg'] == 0)}")

# Generate SQL update statements
print("\n\n-- SQL UPDATE statements:")
print("-- Run these on the PostgreSQL database to update batch_t and base_batch_kg")
print()

for r in recipes:
    if r['batch_t'] > 0 or r['base_batch_kg'] > 0:
        print(f"UPDATE recipe SET batch_t = {r['batch_t']}, base_batch_kg = {r['base_batch_kg']} WHERE recipe_uid = '{r['uid']}';")
