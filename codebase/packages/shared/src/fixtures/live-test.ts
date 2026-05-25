// Canonical identity of the local live-feed test patient.
//
// Single source of truth shared by:
//   - tools/seed (seed:live) — creates these exact rows in Supabase
//   - tools/protocol-shim    — default mapping for prototype id "001"
//   - tools/mock-telemetry   — signals sim uses the beacon MACs below so
//                              position_estimator can resolve a fix
//
// Fixed UUIDs keep the prototype→UUID mapping stable across `supabase db
// reset`, so the shim "just works" with no flags after `npm run seed:live`.

/** Prototype patient id the D1 generators publish under (patient/001/raw/*). */
export const LIVE_TEST_PROTO_ID = '001';

/** Fixed patient UUID — FK target for sensor_readings / events / position_estimates. */
export const LIVE_TEST_PATIENT_ID = '11110000-1111-4111-8111-000000000001';

/** Fixed device UUID — paired to the test patient. */
export const LIVE_TEST_DEVICE_ID = '22220000-2222-4222-8222-000000000001';

/** Fixed floor-plan UUID for the test patient's room. */
export const LIVE_TEST_FLOOR_PLAN_ID = '33330000-3333-4333-8333-000000000001';

/** Canvas → metres scale (matches the demo seed: 1px = 4cm). */
export const LIVE_TEST_SCALE_M_PER_PX = 0.04;

export interface LiveTestBeacon {
  id: string;
  mac: string;
  /** Canvas coordinates on the floor plan. */
  x: number;
  y: number;
  label: string;
}

/**
 * Four beacons, one per room corner (NW/NE/SW/SE). The MACs match the signals
 * the mock-telemetry sim emits, so trilateration produces a moving map dot
 * during the simulated-feed phase. Real hardware reports its own beacon MACs —
 * update these (or register additional beacons) when wiring the physical
 * install.
 */
export const LIVE_TEST_BEACONS: LiveTestBeacon[] = [
  {
    id: '44440000-4444-4444-8444-000000000001',
    mac: 'AA:BB:CC:DD:EE:01',
    x: 140,
    y: 120,
    label: 'Sunroom', // NW corner
  },
  {
    id: '44440000-4444-4444-8444-000000000002',
    mac: 'AA:BB:CC:DD:EE:02',
    x: 1140,
    y: 120,
    label: 'Kitchen', // NE corner
  },
  {
    id: '44440000-4444-4444-8444-000000000003',
    mac: 'AA:BB:CC:DD:EE:03',
    x: 140,
    y: 580,
    label: 'Bedroom', // SW corner
  },
  {
    id: '44440000-4444-4444-8444-000000000004',
    mac: 'AA:BB:CC:DD:EE:04',
    x: 1140,
    y: 580,
    label: 'Bathroom', // SE corner
  },
];
