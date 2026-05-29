# Long-running mqtt_bridge container (Deno).
#
# The bridge is a single always-on process that subscribes to the HiveMQ
# broker, validates + persists each message, and broadcasts signals — the
# production-shaped replacement for `npm run bridge:start` on a laptop.
#
# Build context MUST be the codebase root (so packages/shared, which the
# import map resolves via ../../packages/shared/src, is included). Deploy:
#   cd codebase
#   flyctl deploy --config apps/edge/fly.toml --dockerfile apps/edge/Dockerfile
#
# Pin matches the Deno the project develops against; bump deliberately.
FROM denoland/deno:2.1.4

WORKDIR /app

# Source: edge functions + the shared workspace package the import map needs,
# plus the import map itself (under apps/edge/). --chown so the unprivileged
# `deno` user can write the npm node_modules cache (deno.json nodeModulesDir).
COPY --chown=deno:deno apps/edge ./apps/edge
COPY --chown=deno:deno packages ./packages

USER deno

# Warm the module + npm dependency cache at build time so cold starts are fast.
RUN deno cache \
  --import-map=apps/edge/deno.json \
  apps/edge/functions/mqtt_bridge/longRunning.ts

# No --env-file: Fly injects SUPABASE_* / MQTT_* as real env vars via
# `flyctl secrets set`; --allow-env exposes them to Deno.env.get.
CMD ["run", \
  "--allow-net", \
  "--allow-env", \
  "--allow-read", \
  "--import-map=apps/edge/deno.json", \
  "apps/edge/functions/mqtt_bridge/longRunning.ts"]
