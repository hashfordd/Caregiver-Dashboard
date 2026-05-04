// Edge function: rules_engine
// Triggered after INSERT on sensor_readings or position_estimates. Loads
// enabled alert_rules for the patient, evaluates each rule type, and writes
// rows to `alerts` when conditions match (with cooldown to avoid storms).
//
// TODO: F11 / BE-08 — implement evaluators per rule type:
//   - zone (geofence + dwell)
//   - vitals (HR/SpO2/temp out-of-range)
//   - fall (event-driven; usually fires from the events topic)
//   - inactivity (no motion for N minutes)
//   - repetitive_movement (pattern detection)

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'sensor_readings' | 'position_estimates' | string;
  schema: string;
  record: unknown;
  old_record: unknown | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  // TODO: F11 — load enabled rules, evaluate each, insert alerts rows with
  //             cooldown windows.
  return json({ ok: true, todo: 'F11/BE-08', received: payload.type }, 202);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
