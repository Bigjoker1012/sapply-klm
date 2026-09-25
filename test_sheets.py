#!/usr/bin/env python3
import json, time, base64, urllib.request, urllib.parse, sys

# Read .env manually
with open('/opt/sapply-klm/.env') as f:
    for line in f:
        if line.startswith('GOOGLE_SERVICE_ACCOUNT_JSON='):
            creds = json.loads(line.split('=', 1)[1])
        if line.startswith('GOOGLE_SHEET_ID='):
            sheet_id = line.split('=', 1)[1].strip()

print(f"Service account: {creds['client_email']}")

# Check private key format
pk = creds['private_key']
print(f"Private key starts with: {pk[:40]}")
print(f"Private key length: {len(pk)}")
print(f"Has newlines: {'\\n' in pk}")

# Fix newlines if needed
if '\\n' in pk:
    pk = pk.replace('\\n', '\n')
    print("Fixed newlines in private key")

# Create JWT
header = base64.urlsafe_b64encode(json.dumps({"alg":"RS256","typ":"JWT"}).encode()).rstrip(b'=')
now = int(time.time())
claims = {
    "iss": creds['client_email'],
    "scope": "https://www.googleapis.com/auth/spreadsheets",
    "aud": "https://oauth2.googleapis.com/token",
    "exp": now + 3600,
    "iat": now
}
payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b'=')

# Sign with RSA
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

private_key = serialization.load_pem_private_key(pk.encode(), password=None)
message = header + b'.' + payload
signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
sig_b64 = base64.urlsafe_b64encode(signature).rstrip(b'=')

jwt_token = (header + b'.' + payload + b'.' + sig_b64).decode()
print(f"JWT created, length: {len(jwt_token)}")

# Exchange for access token
data = urllib.parse.urlencode({
    'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    'assertion': jwt_token
}).encode()

req = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
        print(f"Access token obtained! Length: {len(result.get('access_token',''))}")
        
        # Test Sheets API
        token = result['access_token']
        sheets_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/LipStock!A1:I3"
        req2 = urllib.request.Request(sheets_url, headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(req2, timeout=15) as resp2:
            sheets_data = json.loads(resp2.read())
            print(f"Sheets API SUCCESS!")
            print(json.dumps(sheets_data, indent=2, ensure_ascii=False))
except urllib.error.HTTPError as e:
    error_body = e.read().decode()
    print(f"HTTP Error {e.code}: {error_body}")
except Exception as e:
    print(f"Error: {e}")
