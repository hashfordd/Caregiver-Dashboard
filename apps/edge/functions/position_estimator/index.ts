// Edge function: position_estimator
// Triggered after a `signals` payload is ingested. Computes an indoor
// (trilateration + fingerprint) or outdoor (GPS) position estimate and writes
// a row to `position_estimates`.
//
// TODO: F8 / POS-03..07 — implement:
//   - RSSI → distance via per-beacon path-loss model (POS-01/POS-02)
//   - Trilateration solver wrapping Trilateration.js (POS-03)
//   - kNN fingerprint matcher over calibration_points (POS-04)
//   - Fusion + confidence scoring (POS-05/POS-07)
//   - Smoothing filter to suppress jitter (POS-06)
//   - Indoor↔outdoor mode switch with hysteresis (POS-08)

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
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

  // TODO: F8 — fetch beacons + calibration_points for this patient, run the
  //            estimator, insert position_estimates row.
  return json({ ok: true, todo: 'F8/POS-03', received: payload.type }, 202);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
