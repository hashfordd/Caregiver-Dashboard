# Live activity card · IMU motion-gate · Alert-settings hardening

Status: approved · Date: 2026-05-30

Three related improvements to the caregiver dashboard's patient Live tab and
alert settings:

1. A **Current Activity** card that fuses the wearable's motion classification
   with the floor-plan location into one glanceable status.
2. An **IMU motion-gate** so a stationary patient's on-map marker stops drifting
   from triangulation noise, while real movement still tracks smoothly.
3. **Alert-settings input hardening** — replace bare number fields and the raw
   polygon-JSON textarea with guided, validated controls, including an
   on-floor-plan zone picker.

All UI is client-side; the edge position pipeline and recorded history are
untouched.

---

## Background (current behaviour)

- `LiveTab` (`features/patients/tabs/LiveTab.tsx`) renders a 2-col grid
  (`sm:max-w-xl sm:grid-cols-2`) of `SensorCard metric="hr"` + `MovementCard`,
  then a full-width `PatientPositionView` below.
- `MovementCard` (`features/patients/live/MovementCard.tsx`) classifies
  `resting | light | active` inline from accel-magnitude deviation from 1 g plus
  gyro rotation rate, reading `useLiveSensorStore.movement[patientId]`.
- `LivePositionView` (`features/floor-plan/LivePositionView.tsx`) paints the
  **raw** latest estimate from `usePositionMarker()` straight onto the canvas
  (no client smoothing) and derives a location badge via
  `computeLocationContext()` (`features/floor-plan/locationContext.ts`) — e.g.
  "In bed", "Near the door — may be leaving the room", "In the {room}".
- Smoothing (`packages/shared/src/positioning/smooth.ts`, weighted moving
  average) runs **server-side** in the `position_estimator` edge function. A
  stationary patient still wanders because RSSI noise → trilateration jitter
  survives the average.
- Alert rules (`features/alerts/RuleSettingsTab.tsx`, per-patient) render one
  card per type via `RuleCardShell`. Inputs are bare `<input type=number>`
  fields; the Zone rule requires pasting a JSON array of canvas-pixel `[x,y]`
  polygon vertices into a `<textarea>` (`ZoneRuleCard.tsx`).

---

## Feature 1 — Current Activity card (focused status)

**Goal:** the right two columns of the Live tab's top row show "what is the
patient doing right now" at a glance.

**Shared extraction (no behaviour change):**

- New `apps/web/src/lib/activity.ts` (pure): `ActivityState` type, the
  thresholds (`REST_DEV_G=0.08`, `LIGHT_DEV_G=0.3`, `REST_GYRO_DPS=20`,
  `LIGHT_GYRO_DPS=90`), `classifyActivity(devG, gyroDps): ActivityState`,
  `magnitudeDeviationG(magG)`, `ACTIVITY_LABEL`, `activityColor()`. Moved out of
  `MovementCard`.
- `useLiveSensorStore.pushReading` computes and stores `activityState` and
  `activitySince` on `MovementState` (using `classifyActivity`). `activitySince`
  is carried forward while the state is unchanged and reset to the reading's
  timestamp when the class flips — this is the single source of truth for
  "time in this state", correct across all consumers and remounts.
- New hook `features/patients/live/useActivity.ts`:
  `useActivity(patientId) → { state, since, magnitudeG, gyroDps, lastReceivedAt, stale }`.
- `MovementCard` refactored to import from `lib/activity.ts` (keeps its current
  appearance, still shows the g / °/s detail line).

**New component** `features/patients/live/ActivitySummaryCard.tsx`:

- Headline `"{State} — {location}"` (e.g. _Resting — In bed_) using
  `useActivity` + `usePatientLocation` (below). Falls back to the state alone
  when no location context.
- Secondary rows: room name + "{n} min in this state"; current heart rate
  (from `useLiveSensorStore.cards[patientId].hr`); freshness pip (reusing the
  staleness convention, 30 s threshold).
- Mirrors the `Card` shell of `SensorCard`/`MovementCard`. No new network calls.

**Layout** (`LiveTab.tsx`):

- Grid becomes `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`, dropping
  `sm:max-w-xl`.
- `SensorCard` (HR) and `MovementCard` are single cells; `ActivitySummaryCard`
  carries `className="sm:col-span-2 lg:col-span-2"` so it is full-width beneath
  HR+Movement on tablet and the right half on desktop.
- Floor plan stays full-width below.

---

## Feature 2 — IMU motion-gate (hold resting · smooth active)

**Goal:** when the IMU says the patient is at rest, the on-map marker holds
still; when they move, it tracks smoothly. Reduces visual drift and false
"Near the door" location flips.

**New pure module** `features/floor-plan/motionGate.ts`:

- `GateState` (internal): `{ anchor, display, lastState, lastRecordedAt,
farTicks }`.
- `initGateState(): GateState`.
- `stepGate(prev, input, activity, scaleMetersPerPixel) → { state, display }`
  where `input` is `{ x, y, recorded_at, confidence } | null` and `display` is
  `{ x, y, confidence, recorded_at, held } | null`.
- Constants: `EMA_ALPHA_LIGHT`, `EMA_ALPHA_ACTIVE` (active snappier),
  `RELEASE_DISTANCE_M = 1.5`, `RELEASE_TICKS = 3`.
- Rules:
  - `input == null` → `display = null` (clear marker), gate reset.
  - **Resting** — on entry (`prev.lastState !== 'resting'`) set
    `anchor = prev.display ?? input`; thereafter hold `display = anchor`
    (`held = true`). If `dist(input, anchor) * scale > RELEASE_DISTANCE_M` for
    `RELEASE_TICKS` consecutive ticks, release (`anchor = display = input`) —
    catches a genuine move the IMU missed (e.g. wheelchair transfer).
  - **Light / active / null-activity** — clear anchor; EMA toward `input`
    (`display = lerp(prev.display ?? input, input, alpha)`), `held = false`.
  - **Idempotent**: if `input.recorded_at === prev.lastRecordedAt` and
    `activity === prev.lastState`, return `prev` unchanged — safe for multiple
    consumers and decoupled IMU/position streams.
  - Outdoor / null-canvas estimates pass through ungated.

**New store** `lib/stores/gatedPositionStore.ts`: per-patient
`{ gate, display }`, `pushRaw(patientId, rawRow, activity, scale)` delegating to
`stepGate` (idempotency makes repeat calls free).

**New hook** `features/floor-plan/useGatedPositionMarker.ts`: reads raw estimate
(`usePositionMarker`), current `activity` (`useActivity`), and floor-plan scale
(`useFloorPlan`); drives `gatedPositionStore.pushRaw` in an effect; returns a
`PositionEstimateRow`-shaped object with `x_canvas`/`y_canvas` overridden by the
gated display (plus a `held` flag), so consumers need no shape changes.

**Wiring:** `LivePositionView` uses `useGatedPositionMarker()` for both the
marker sprite and the location context (via `usePatientLocation`, fed the gated
estimate). Outdoor `PatientPositionView` keeps the raw `usePositionMarker`.
Optional: marker tooltip notes "Holding — at rest" when `held`.

**Shared extraction** `features/floor-plan/usePatientLocation.ts`: lifts the
floor-plan/rooms/connectors/furniture queries + `computeLocationContext` out of
`LivePositionView` into one hook
(`usePatientLocation(patientId, estimate) → { context, roomName }`), consumed by
both `LivePositionView` and `ActivitySummaryCard`.

---

## Feature 3 — Alert-settings hardening + zone picker

**Goal:** make every rule easy for a non-technical caregiver to read and fill.

**New input primitives** `features/alerts/inputs/`:

- `NumberField` — labelled number input with in-field unit suffix, ± steppers,
  and min/max clamp on blur/step. Props: `value, onChange, unit, min, max, step`.
- `PresetChips` — quick-pick buttons that set common values.
- `clampToRange()` helper (unit-tested).

**Per-card updates** (units shown in-field, sane clamps, presets, one-line
plain-English description, stronger validation):

| Rule                   | Field(s)           | Control               | Presets / clamp                    |
| ---------------------- | ------------------ | --------------------- | ---------------------------------- |
| Inactivity             | `inactive_minutes` | NumberField (min)     | 30 m / 1 h / 2 h / 4 h; 1–1440     |
| Device silence         | `silence_minutes`  | NumberField (min)     | 5 / 15 / 30 / 60; 1–1440           |
| Zone                   | `dwell_seconds`    | NumberField (s)       | Immediate(0) / 10 / 30 / 60; 0–600 |
| Zone                   | `polygon`          | **ZonePolygonPicker** | (see below)                        |
| Vitals/HR              | `min`, `max`       | NumberField (bpm)     | 30–220, keep min<max check         |
| Door proximity         | `radius_m`         | NumberField (m)       | 0.5–5, step 0.5                    |
| Door / Room transition | `dwell_seconds`    | NumberField (s)       | Immediate / 10 / 30 / 60           |
| Fall                   | —                  | description only      | —                                  |

**ZonePolygonPicker** `features/alerts/rule-types/ZonePolygonPicker.tsx`:

- `Dialog` embedding `FloorPlanCanvas` (`editing`, room/polygon draw mode).
- Caregiver draws the zone polygon; "Use this shape" reads
  `canvasRef.getSelectedPolygonVertices()` (already used by "Promote to room")
  → canvas-coord `[x,y][]`, returned to `ZoneRuleCard`.
- Re-opening seeds the existing polygon as a read-only overlay for context.
- `ZoneRuleCard` replaces the JSON textarea with a summary ("Zone with N points
  · drawn on the floor plan") + "Draw / edit on floor plan" button. Saved shape
  validated as ≥3 `[number, number]` pairs (same contract as today).

---

## Testing & sequencing

Pure logic is TDD-first with vitest:

- `test/patients/activity.test.ts` — `classifyActivity` boundaries, `activitySince` carry/reset.
- `test/floor-plan/motionGate.test.ts` — resting hold, far-jump release, active EMA, idempotency, outdoor pass-through.
- `test/alerts/numberField.test.ts` — `clampToRange`.

Build order:

1. Shared: `lib/activity.ts` + store fields + `useActivity`; refactor `MovementCard`.
2. `usePatientLocation`; refactor `LivePositionView`.
3. `ActivitySummaryCard` + `LiveTab` layout.
4. `motionGate` + `gatedPositionStore` + `useGatedPositionMarker`; wire `LivePositionView`.
5. Alert input primitives + per-card updates.
6. `ZonePolygonPicker` + `ZoneRuleCard` (largest/riskiest, last).

Verify: full `vitest run`, `tsc --noEmit`, `eslint .` clean at the end.

**Primary risk:** the live-canvas interaction in `ZonePolygonPicker`. Everything
else is bounded reuse of existing stores, hooks, and the canvas handle.
