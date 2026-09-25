#!/bin/bash
cd /opt/sapply-klm
source .env 2>/dev/null

# Extract private key
PRIVATE_KEY=$(echo "$GOOGLE_SERVICE_ACCOUNT_JSON" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["private_key"])')
echo "$PRIVATE_KEY" > /tmp/sa_key.pem

# Create JWT
HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
NOW=$(date +%s)
EXP=$((NOW + 3600))
CLAIMS=$(python3 -c "
import base64, json
claims = {
    'iss': 'sapply@lunar-solution-460312-b7.iam.gserviceaccount.com',
    'scope': 'https://www.googleapis.com/auth/spreadsheets',
    'aud': 'https://oauth2.googleapis.com/token',
    'exp': $EXP,
    'iat': $NOW
}
encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
print(encoded)
")
PAYLOAD="$HEADER.$CLAIMS"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -sign /tmp/sa_key.pem | base64 -w0 | tr '+/' '-_' | tr -d '=')
JWT="$PAYLOAD.$SIGNATURE"

echo "Exchanging JWT for access token..."
RESPONSE=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=$JWT")

echo "Response: $RESPONSE"

# If we got a token, try to read the spreadsheet
ACCESS_TOKEN=$(echo "$RESPONSE" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("access_token",""))' 2>/dev/null)
if [ -n "$ACCESS_TOKEN" ]; then
  echo "Got access token, testing Sheets API..."
  curl -s "https://sheets.googleapis.com/v4/spreadsheets/$GOOGLE_SHEET_ID/values/LipStock!A1:A3" \
    -H "Authorization: Bearer $ACCESS_TOKEN" | head -20
fi

rm -f /tmp/sa_key.pem
