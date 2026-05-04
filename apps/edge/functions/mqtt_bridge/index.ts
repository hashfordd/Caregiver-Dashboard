// Edge function: mqtt_bridge
// TODO: BE-06 — subscribe to the MQTT broker, validate against shared Zod
// schemas, persist to Postgres. NOTE: Supabase Edge Functions are
// request-scoped; the production deployment of mqtt_bridge will likely run as
// a long-running Deno process (Fly.io / EC2) instead. This stub provides the
// shape and an HTTP-mode hook for ad-hoc validation.

import { TelemetryMessage, SignalsMessage, EventMessage, parseTopic } from '@alzcare/shared/mqtt';

interface BridgePayload {
  topic: string;
  message: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let body: BridgePayload;
  try {
    body = (await req.json()) as BridgePayload;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const parsed = parseTopic(body.topic);
  if (!parsed) {
    return json({ error: `invalid topic: ${body.topic}` }, 400);
  }

  const schema =
    parsed.kind === 'telemetry'
      ? TelemetryMessage
      : parsed.kind === 'signals'
        ? SignalsMessage
        : EventMessage;

  const validation = schema.safeParse(body.message);
  if (!validation.success) {
    return json({ error: 'validation failed', issues: validation.error.issues }, 400);
  }

  // TODO: BE-06 — persist to sensor_readings for telemetry; persist signals;
  //               persist events to a future events table or alerts directly.
  // TODO: BE-08 — fan out to rules_engine after persist.

  return json({ ok: true, kind: parsed.kind, accepted: true }, 202);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
