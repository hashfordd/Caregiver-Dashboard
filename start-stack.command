#!/usr/bin/env bash
# Double-click in Finder to bring up the whole local AlzCare stack.
# (Opens this in Terminal; Ctrl-C in that window stops the live services.)
cd "$(cd "$(dirname "$0")" && pwd)/codebase" || exit 1
exec npm run stack:up
