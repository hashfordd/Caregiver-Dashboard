#!/usr/bin/env bash
# ============================================================================
# Turn ON the local ingest server, pointed at HOSTED Supabase.
#
# Starts only the on-prem pieces — MQTT broker + bridge + shim — which write to
# the hosted project. Supabase, the edge functions, and the dashboard are
# hosted (see DEPLOY.md). While this is running, the live Vercel dashboard
# shows "Server online" and pulls the data; Ctrl-C and it goes offline.
#
# Config comes from apps/edge/.env.live (copy apps/edge/.env.live.example).
# Usage:  npm run stack:live
# ============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." # → codebase/

ENV_FILE='apps/edge/.env.live'
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy apps/edge/.env.live.example to it and fill in your hosted Supabase URL + service key."
  exit 1
fi

# Load hosted config for the shim (the bridge reads $ENV_FILE via --env-file).
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "$ENV_FILE must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (hosted)."
  exit 1
fi

printf '\n\033[1;36m▶ Local ingest server → %s\033[0m\n' "$SUPABASE_URL"

# Broker (clear any stale container first)
docker rm -f alzcare-mosquitto >/dev/null 2>&1 || true
npm run broker:up

# The shim ensures its device + reads placed beacons from the hosted project.
export SB_SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export MQTT_BRIDGE_PASSWORD="${MQTT_PASSWORD:-bridgepass}"
export ALLOW_NON_LOCAL=1

printf '\033[1;36m▶ Starting bridge + shim (Ctrl-C stops both)\033[0m\n'
npx concurrently \
  --names 'bridge,shim' \
  --prefix-colors 'blue,green' \
  'npm run bridge:start:live' \
  "npm run shim:start -- --url $SUPABASE_URL --allow-non-local"
