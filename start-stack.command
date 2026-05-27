#!/usr/bin/env bash
# Double-click in Finder to start the AlzCare ingest server (bridge + shim)
# against HiveMQ + hosted Supabase. (Opens in Terminal; Ctrl-C stops it.)
cd "$(cd "$(dirname "$0")" && pwd)/codebase" || exit 1
exec npm run stack:up
