#!/usr/bin/env bash
# Stop the container-backed parts of the stack (broker + Supabase).
# The bridge / functions / shim / dashboard run in the foreground of
# `stack:up` — Ctrl-C that terminal to stop them.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." # → codebase/

echo '▶ Stopping MQTT broker…'
npm run broker:down || true

echo '▶ Stopping Supabase…'
supabase stop || true

echo 'Done. (If stack:up is still running in another terminal, Ctrl-C it to stop the bridge/functions/shim/dashboard.)'
