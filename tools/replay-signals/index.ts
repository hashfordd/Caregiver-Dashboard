// F8 verification harness. Two subcommands:
//
//   generate <output-dir> --patient-id <uuid> --device-id <uuid>
//                                  --beacon-1 <id>:<x>:<y> [--beacon-2 ...] ...
//     Emits walk-1.jsonl (SignalsMessage payloads) + walk-1-truth.jsonl
//     (ground-truth canvas coords per tick) into <output-dir>. Synthesised
//     by reverse-applying the path-loss formula along a straight-line
//     walk through the room, with seeded Gaussian RSSI noise.
//
//   run <fixture-path> --truth <truth-path>
//                      --bridge-url <url> --service-key <key>
//                      --patient-id <uuid>
//     Posts each fixture line to the mqtt_bridge HTTP entry, waits for
//     position_estimator to drain, then queries position_estimates and
//     joins against truth (by recorded_at) to compute mean / p50 / p80
//     / p95 / max error in metres. Exits 0 if the F8 accuracy gate
//     (< 1.5 m on 80% of samples) is met, else 1.
//
// The synthesis path matches the path-loss model used by F8's pipeline,
// so the harness exercises the algorithm against its own forward model
// — which catches algorithmic regressions deterministically. Real-
// environment fixtures are V2 (BACKLOG); the synthetic gate is the
// V1 verification artefact for the F8 PR description.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_PATH_LOSS_EXPONENT, DEFAULT_RSSI_AT_1M } from '@alzcare/shared/positioning';
import type { SignalsMessage } from '@alzcare/shared/mqtt';

interface BeaconArg {
  id: string;
  x: number;
  y: number;
  rssi_at_1m: number;
}

interface TruthRow {
  recorded_at: string;
  x_canvas: number;
  y_canvas: number;
}

interface PositionRow {
  recorded_at: string;
  x_canvas: number | null;
  y_canvas: number | null;
  mode: 'indoor' | 'outdoor';
  confidence: number | null;
}

const SCALE_DEFAULT = 0.014; // matches the smoke patient seeded in supabase/seed.sql
const TICK_INTERVAL_MS = 1000;
const TICK_COUNT = 60;

function fail(msg: string): never {
  console.error(`replay-signals: ${msg}`);
  process.exit(2);
}

/** Phase H item 70: refuse to target non-local URLs by default. The
 *  harness writes to position_estimates and posts to the bridge with a
 *  service-role key; pointing at prod would inject fake estimates and
 *  trigger live alerts. Pass --allow-non-local or set
 *  ALLOW_NON_LOCAL=1 to override (e.g. for staging accuracy runs). */
function isLocalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

function assertLocalOrAllowed(label: string, raw: string, allowNonLocal: boolean): void {
  if (isLocalUrl(raw) || allowNonLocal) return;
  fail(
    `refusing to target non-local ${label} (${raw}). Pass --allow-non-local or set ALLOW_NON_LOCAL=1 to override.`,
  );
}

/** Park-Miller LCG — deterministic per-seed; gives the harness a
 *  reproducible noise sequence so accuracy numbers are stable. */
function rng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function gaussian(rand: () => number, mean: number, stddev: number): number {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

function parseBeaconArg(arg: string): BeaconArg {
  // Format: `<mac>|<x>,<y>[,<rssi1m>]`. The `|` separator is required
  // because BLE MAC addresses already contain colons (so a `:`-split
  // on `AA:BB:CC:DD:EE:01:60:120:rssi` is ambiguous).
  const [id, rest] = arg.split('|');
  if (!id || !rest) {
    fail(`invalid --beacon arg: ${arg} (expected '<mac>|<x>,<y>[,<rssi1m>]')`);
  }
  const [xs, ys, rssi1m] = rest.split(',');
  if (!xs || !ys) {
    fail(`invalid --beacon arg: ${arg} (expected '<mac>|<x>,<y>[,<rssi1m>]')`);
  }
  return {
    id,
    x: Number(xs),
    y: Number(ys),
    rssi_at_1m: rssi1m != null && rssi1m !== '' ? Number(rssi1m) : DEFAULT_RSSI_AT_1M,
  };
}

// ─── generate subcommand ──────────────────────────────────────────────

async function generate(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      'patient-id': { type: 'string' },
      'device-id': { type: 'string' },
      'start-x': { type: 'string', default: '60' },
      'start-y': { type: 'string', default: '120' },
      'end-x': { type: 'string', default: '300' },
      'end-y': { type: 'string', default: '120' },
      'noise-db': { type: 'string', default: '1.5' },
      seed: { type: 'string', default: '2026' },
      beacon: { type: 'string', multiple: true, default: [] },
      ticks: { type: 'string', default: String(TICK_COUNT) },
    },
    allowPositionals: true,
  });
  const outputDir = positionals[0];
  if (!outputDir) fail('generate: missing <output-dir>');
  const patient = values['patient-id'];
  const device = values['device-id'];
  if (!patient) fail('generate: --patient-id required');
  if (!device) fail('generate: --device-id required');
  const beacons = (values.beacon as string[]).map(parseBeaconArg);
  if (beacons.length < 3) fail('generate: at least 3 --beacon args required (id:x:y[:rssi1m])');

  const startX = Number(values['start-x']);
  const startY = Number(values['start-y']);
  const endX = Number(values['end-x']);
  const endY = Number(values['end-y']);
  const noiseDb = Number(values['noise-db']);
  const seed = Number(values.seed);
  const ticks = Number(values.ticks);
  const rand = rng(seed);

  const fixtureLines: string[] = [];
  const truthLines: string[] = [];
  const t0 = Date.parse('2026-05-05T12:00:00.000Z');
  for (let i = 0; i < ticks; i++) {
    const f = ticks === 1 ? 0 : i / (ticks - 1);
    const truth = { x: startX + f * (endX - startX), y: startY + f * (endY - startY) };
    const recordedAt = new Date(t0 + i * TICK_INTERVAL_MS).toISOString();
    const ble = beacons.map((b) => {
      const dx = b.x - truth.x;
      const dy = b.y - truth.y;
      const distM = Math.sqrt(dx * dx + dy * dy) * SCALE_DEFAULT;
      const rssiClean =
        b.rssi_at_1m - 10 * DEFAULT_PATH_LOSS_EXPONENT * Math.log10(Math.max(distM, 0.01));
      const rssi = rssiClean + (noiseDb > 0 ? gaussian(rand, 0, noiseDb) : 0);
      return { mac: b.id, rssi: Math.round(rssi * 10) / 10 };
    });
    const sig: SignalsMessage = {
      v: 1,
      patient_id: patient,
      device_id: device,
      recorded_at: recordedAt,
      ble,
      wifi: [],
    };
    fixtureLines.push(JSON.stringify(sig));
    truthLines.push(
      JSON.stringify({
        recorded_at: recordedAt,
        x_canvas: truth.x,
        y_canvas: truth.y,
      } satisfies TruthRow),
    );
  }

  const fixturePath = resolve(outputDir, 'walk-1.jsonl');
  const truthPath = resolve(outputDir, 'walk-1-truth.jsonl');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, fixtureLines.join('\n') + '\n', 'utf-8');
  await writeFile(truthPath, truthLines.join('\n') + '\n', 'utf-8');
  console.log(
    `replay-signals: generated ${ticks} ticks → ${fixturePath} + ${truthPath}` +
      ` (noise=${noiseDb} dB, seed=${seed}, scale=${SCALE_DEFAULT} m/px)`,
  );
}

// ─── run subcommand ───────────────────────────────────────────────────

async function readJsonl<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      truth: { type: 'string' },
      'bridge-url': { type: 'string', default: 'http://127.0.0.1:54321/functions/v1/mqtt_bridge' },
      url: { type: 'string', default: 'http://127.0.0.1:54321' },
      'service-key': { type: 'string' },
      'patient-id': { type: 'string' },
      'target-error-m': { type: 'string', default: '1.5' },
      'target-percentile': { type: 'string', default: '0.8' },
      'drain-ms': { type: 'string', default: '2000' },
      // Phase H item 70: same non-local guard as mock-telemetry.
      'allow-non-local': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const fixturePath = positionals[0];
  if (!fixturePath) fail('run: missing <fixture-path>');
  const truthPath = values.truth;
  const bridgeUrl = values['bridge-url']!;
  const url = values.url!;
  const serviceKey = values['service-key'] ?? process.env.SB_SERVICE_KEY;
  const patientId = values['patient-id'];
  if (!serviceKey) fail('run: --service-key (or SB_SERVICE_KEY env) required');
  if (!patientId) fail('run: --patient-id required');

  const allowNonLocal = values['allow-non-local'] === true || process.env.ALLOW_NON_LOCAL === '1';
  assertLocalOrAllowed('Supabase URL', url, allowNonLocal);
  assertLocalOrAllowed('bridge URL', bridgeUrl, allowNonLocal);
  const targetErrorM = Number(values['target-error-m']);
  const targetPct = Number(values['target-percentile']);
  const drainMs = Number(values['drain-ms']);

  const fixture = await readJsonl<SignalsMessage>(fixturePath);
  console.log(`replay-signals: read ${fixture.length} ticks from ${fixturePath}`);

  // Snapshot the existing position_estimates count so we can isolate
  // rows produced by this run from prior history.
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const t0 = new Date().toISOString();

  // Replay: post each fixture line to the bridge HTTP entry. Sleep
  // between posts to mimic the wearable's 1 Hz cadence — this
  // exercises the smoothing window the way it'd run live.
  let postedOk = 0;
  for (let i = 0; i < fixture.length; i++) {
    const sig = fixture[i]!;
    const topic = `device/${sig.patient_id}/signals`;
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ topic, message: sig }),
    });
    if (res.ok) postedOk += 1;
    else console.warn(`replay-signals: bridge ${res.status} on tick ${i}`);
    if (i < fixture.length - 1) await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }
  console.log(`replay-signals: posted ${postedOk}/${fixture.length} ticks; draining...`);
  await new Promise((r) => setTimeout(r, drainMs));

  // Pull every position_estimates row produced after the run started.
  const rowsRes = await supabase
    .from('position_estimates')
    .select('recorded_at, x_canvas, y_canvas, mode, confidence')
    .eq('patient_id', patientId)
    .gt('created_at', t0)
    .order('recorded_at', { ascending: true });
  if (rowsRes.error) {
    fail(`run: query failed — ${rowsRes.error.message}`);
  }
  const rows = (rowsRes.data ?? []) as PositionRow[];
  console.log(`replay-signals: ${rows.length} position_estimates rows landed`);

  if (rows.length === 0) {
    console.error('replay-signals: no estimates produced; cannot report accuracy');
    process.exit(1);
  }

  // Fetch the floor plan's scale so the error in pixels can be
  // reported in metres. Take the most recent floor plan for the patient.
  const planRes = await supabase
    .from('floor_plans')
    .select('scale_meters_per_pixel')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const scale =
    (planRes.data as { scale_meters_per_pixel: number | null } | null)?.scale_meters_per_pixel ??
    SCALE_DEFAULT;

  if (!truthPath) {
    console.log('replay-signals: no --truth supplied; skipping accuracy report');
    return;
  }

  const truth = await readJsonl<TruthRow>(truthPath);
  const truthByTime = new Map(truth.map((t) => [t.recorded_at, t] as const));

  const errors: number[] = [];
  for (const row of rows) {
    if (row.mode !== 'indoor' || row.x_canvas == null || row.y_canvas == null) continue;
    const t = truthByTime.get(row.recorded_at);
    if (!t) continue;
    const dxPx = row.x_canvas - t.x_canvas;
    const dyPx = row.y_canvas - t.y_canvas;
    errors.push(Math.sqrt(dxPx * dxPx + dyPx * dyPx) * scale);
  }
  if (errors.length === 0) {
    console.error('replay-signals: no truth-joined rows; cannot report accuracy');
    process.exit(1);
  }

  const sorted = [...errors].sort((a, b) => a - b);
  const mean = sorted.reduce((acc, e) => acc + e, 0) / sorted.length;
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  const underTarget = sorted.filter((e) => e < targetErrorM).length / sorted.length;

  console.log('');
  console.log('=== F8 accuracy report ===');
  console.log(`  fixture:           ${fixturePath}`);
  console.log(`  truth-joined:      ${errors.length} ticks`);
  console.log(`  scale_m_per_px:    ${scale}`);
  console.log(`  mean error:        ${mean.toFixed(2)} m`);
  console.log(`  p50:               ${p(0.5).toFixed(2)} m`);
  console.log(`  p80:               ${p(0.8).toFixed(2)} m`);
  console.log(`  p95:               ${p(0.95).toFixed(2)} m`);
  console.log(`  max:               ${sorted[sorted.length - 1]!.toFixed(2)} m`);
  console.log(`  under ${targetErrorM} m:  ${(underTarget * 100).toFixed(1)} %`);
  console.log(
    `  target:            < ${targetErrorM} m on ${(targetPct * 100).toFixed(0)} % of samples`,
  );

  const passed = underTarget >= targetPct;
  console.log(`  result:            ${passed ? 'PASS ✓' : 'FAIL ✗'}`);
  process.exit(passed ? 0 : 1);
}

// ─── entry point ──────────────────────────────────────────────────────

const subcommand = process.argv[2];
if (subcommand === 'generate') {
  await generate(process.argv.slice(3));
} else if (subcommand === 'run') {
  await run(process.argv.slice(3));
} else {
  console.error('replay-signals: usage:');
  console.error('  tsx index.ts generate <output-dir> --patient-id <uuid> --device-id <uuid> \\');
  console.error("       --beacon 'AA:BB:CC:DD:EE:01|0,0' --beacon 'AA:BB:CC:DD:EE:02|300,0' \\");
  console.error("       --beacon 'AA:BB:CC:DD:EE:03|150,260' [...]");
  console.error('  tsx index.ts run <fixture-path> --truth <truth-path> --service-key <key> \\');
  console.error('       --patient-id <uuid>');
  process.exit(2);
}
