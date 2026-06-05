#!/bin/bash
# Refresh Truth Social token and update Vercel env var.
# Run this locally on a schedule via launchd or cron.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
set -a
source "$PROJECT_DIR/.env"
set +a

echo "[refresh] Extracting token..."
TOKEN=$(node "$SCRIPT_DIR/refresh-token.mjs")

if [ -z "$TOKEN" ]; then
  echo "[refresh] ERROR: No token extracted"
  exit 1
fi

echo "[refresh] Token extracted successfully."

# Update .env file
if grep -q "^TRUTHSOCIAL_TOKEN=" "$PROJECT_DIR/.env"; then
  sed -i '' "s|^TRUTHSOCIAL_TOKEN=.*|TRUTHSOCIAL_TOKEN=$TOKEN|" "$PROJECT_DIR/.env"
else
  echo "TRUTHSOCIAL_TOKEN=$TOKEN" >> "$PROJECT_DIR/.env"
fi

echo "[refresh] .env updated."

# Update Vercel env var if VERCEL_TOKEN is set
if [ -n "${VERCEL_TOKEN:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  echo "[refresh] Updating Vercel env var..."

  # Find and delete existing env var
  ENV_ID=$(curl -s \
    "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env${VERCEL_TEAM_ID:+?teamId=$VERCEL_TEAM_ID}" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    | python3 -c "import sys,json; envs=json.load(sys.stdin).get('envs',[]); matches=[e['id'] for e in envs if e.get('key')=='TRUTHSOCIAL_TOKEN']; print(matches[0] if matches else '')" 2>/dev/null)

  if [ -n "$ENV_ID" ]; then
    curl -s -X DELETE \
      "https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${ENV_ID}${VERCEL_TEAM_ID:+?teamId=$VERCEL_TEAM_ID}" \
      -H "Authorization: Bearer $VERCEL_TOKEN" > /dev/null
  fi

  # Create new env var
  curl -s -X POST \
    "https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env${VERCEL_TEAM_ID:+?teamId=$VERCEL_TEAM_ID}" \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"TRUTHSOCIAL_TOKEN\",\"value\":\"$TOKEN\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" > /dev/null

  echo "[refresh] Vercel env var updated."
else
  echo "[refresh] Skipping Vercel update (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)."
fi

echo "[refresh] Done."
