#!/usr/bin/env bash
# ============================================================================
# One-command local stack for the AlzCare MQTT demo.
#
# Brings up everything in order, idempotently (safe to re-run):
#   1. Docker Desktop (started if not running)
#   2. Mosquitto broker
#   3. Supabase (DB + edge runtime)
#   4. Seed: admin/provider + the fixed "Live Feed Test" patient
#   5. Vault secrets for the alert/position webhooks
#   6. The long-running services — bridge, edge functions, shim, dashboard —
#      in ONE terminal with prefixed output. Ctrl-C stops them all.
#
# Usage:  npm run stack:up      (or double-click ../start-stack.command)
# ============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." # → codebase/

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }

# --- 1. Docker daemon -------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  say 'Starting Docker Desktop…'
  open -a Docker || true
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  docker info >/dev/null 2>&1 || {
    echo 'Docker did not start — open Docker Desktop manually and re-run.'
    exit 1
  }
fi

# --- 2. Mosquitto broker (clear any stale container first) ------------------
say 'Starting MQTT broker…'
docker rm -f alzcare-mosquitto >/dev/null 2>&1 || true
npm run broker:up

# --- 3. Supabase (no-op if already running) ---------------------------------
say 'Starting Supabase…'
supabase start

SB_SERVICE_KEY="$(supabase status -o env | awk -F= '/SERVICE_ROLE_KEY/{print $2}' | tr -d '"')"
export SB_SERVICE_KEY
if [ -z "$SB_SERVICE_KEY" ]; then
  echo 'Could not read the Supabase service-role key — is Supabase running?'
  exit 1
fi

# Sanity: the local stack needs local URLs in the env files.
grep -q '127.0.0.1' apps/edge/.env 2>/dev/null ||
  warn 'apps/edge/.env may not point at local Supabase (expected 127.0.0.1:54321).'
grep -q '127.0.0.1' apps/web/.env.local 2>/dev/null ||
  warn 'apps/web/.env.local may not point at local Supabase (login will fail against hosted).'

# --- 4. Seed admin/provider + the fixed live-test patient (idempotent) ------
say 'Seeding admin + Live Feed Test patient…'
npm run seed
npm run seed:live

# --- 5. Long-running services (one terminal; Ctrl-C stops all) --------------
# The bridge computes positioning + rules + inactivity in-process, so there's
# no edge-function server or Vault webhook wiring to run locally.
say 'Starting bridge + shim + dashboard…  (Ctrl-C to stop all)'
export MQTT_BRIDGE_PASSWORD="${MQTT_BRIDGE_PASSWORD:-bridgepass}"

npx concurrently \
  --names 'bridge,shim,web' \
  --prefix-colors 'blue,green,cyan' \
  'npm run bridge:start' \
  'npm run shim:start' \
  'npm run dev'
