#!/usr/bin/env bash
# ============================================================================
# Start the AlzCare ingest server — bridge + shim — against HiveMQ + hosted
# Supabase. This is the whole runtime stack: the broker is HiveMQ Cloud
# (always-on) and the database + dashboard are hosted, so nothing runs in
# Docker and there is no local Supabase. Both services run in ONE terminal with
# prefixed output; Ctrl-C stops them.
#
# Config comes from apps/edge/.env (copy apps/edge/.env.example).
# Usage:  npm run stack:up      (or double-click ../start-stack.command)
# ============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." # → codebase/

ENV_FILE='apps/edge/.env'
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy apps/edge/.env.example to it and fill in your hosted Supabase + HiveMQ values."
  exit 1
fi

# Load config for the shim (the bridge reads $ENV_FILE via --env-file).
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

missing=''
[ -z "${SUPABASE_URL:-}" ] && missing="$missing SUPABASE_URL"
[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && missing="$missing SUPABASE_SERVICE_ROLE_KEY"
[ -z "${MQTT_BROKER_URL:-}" ] && missing="$missing MQTT_BROKER_URL"
[ -z "${MQTT_USERNAME:-}" ] && missing="$missing MQTT_USERNAME"
[ -z "${MQTT_PASSWORD:-}" ] && missing="$missing MQTT_PASSWORD"
if [ -n "$missing" ]; then
  echo "$ENV_FILE is missing:$missing"
  exit 1
fi

printf '\n\033[1;36m▶ Ingest server → %s\033[0m\n' "$SUPABASE_URL"
printf '  broker: %s\n' "$MQTT_BROKER_URL"

# The shim ensures its device + reads placed beacons from the hosted project.
# Pass the broker + Supabase config to it explicitly (flags win over env); the
# password also rides on MQTT_BRIDGE_PASSWORD.
export SB_SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export MQTT_BRIDGE_PASSWORD="$MQTT_PASSWORD"
export ALLOW_NON_LOCAL=1

printf '\033[1;36m▶ Starting bridge + shim (Ctrl-C stops both)\033[0m\n'
npx concurrently \
  --names 'bridge,shim' \
  --prefix-colors 'blue,green' \
  'npm run bridge:start' \
  "npm run shim:start -- --url $SUPABASE_URL --allow-non-local --mqtt-broker-url $MQTT_BROKER_URL --mqtt-username $MQTT_USERNAME"
