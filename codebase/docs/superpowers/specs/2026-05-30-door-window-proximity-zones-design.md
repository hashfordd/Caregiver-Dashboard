# Door / Window Proximity Zones — Design

**Date:** 2026-05-30  
**Status:** Implemented

---

## Problem

Caregivers need to be alerted when a patient approaches a door (exit risk) or
window (window-risk) on the indoor floor plan. The backend rules engine already
supported `door_proximity` rules via a point-to-segment distance test, but the
zones were not visible to caregivers, and rules had to be created manually
through the alerts settings UI. This was too much friction and left new
connectors without any alert coverage.

---

## Architecture

### Layers involved

| Layer            | Location                                                        | Role                                                    |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Geometry helper  | `packages/shared/src/rules/geofence.ts`                         | `pointInSegmentRect` — pure oriented-rect test          |
| Rule evaluator   | `packages/shared/src/rules/evaluate.ts`                         | `evaluateDoorProximity` with `shape='rectangle'` branch |
| Rule type schema | `packages/shared/src/rules/types.ts`                            | `DoorProximityParams.shape` optional field              |
| Auto-provision   | `apps/web/src/features/floor-plan/useConnectorProximityRule.ts` | Hook: create/delete/update rule alongside connector     |
| Connector CRUD   | `apps/web/src/features/place/PlaceWorkspace.tsx`                | Wires hook into save + delete flows                     |
| Canvas rendering | `apps/web/src/features/floor-plan/FloorPlanCanvas.tsx`          | SVG oriented-rect zone overlay                          |
| Sprite type      | `apps/web/src/features/floor-plan/types.ts`                     | `RoomConnectorSprite.proximityRadiusPx`                 |
| Live view        | `apps/web/src/features/floor-plan/LivePositionView.tsx`         | Passes proximity radius into sprites                    |
| Rail UI          | `apps/web/src/features/place/RoomsRail.tsx`                     | Inline buffer-radius input per connector                |

---

## Approved Decisions

### 1. True-rectangle zone shape

The proximity zone is an **oriented rectangle** aligned to the connector
segment. Given segment A→B and radius `r` (metres):

- The rectangle's "along" axis extends `r` past each endpoint (end caps).
- The perpendicular half-width is `r` on each side of the segment.

This is implemented by `pointInSegmentRect(px, py, ax, ay, bx, by, rPx)` in
`geofence.ts`. It is **additive**: the existing point-to-segment-distance path
is preserved as `shape='segment'` (default/undefined), so all existing rules
continue to behave without change.

The evaluator selects the rect test when `params.shape === 'rectangle'`. The
`distance_m` field in the alert context is always the point-to-segment distance
(informational, regardless of shape), so caregivers can tune `radius_m` from
fired alerts.

### 2. Fixed 1.0 m default + per-zone override

New door/window connectors are auto-provisioned with `radius_m = 1.0` and
`dwell_seconds = 3`. Each connector in the RoomsRail shows an inline numeric
input ("Zone … m") that writes back `radius_m` to the paired rule on
blur/Enter.

The default (1.0 m at typical 50 px/m scale → 50 px zone) is a starting point;
caregivers are expected to tune per-installation based on the physical doorway
width and corridor geometry.

### 3. door = critical / window = warn (AlertSeverity)

| Connector kind | Severity   | Rationale                                                                                              |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `door`         | `critical` | Exit risk — a patient approaching or opening a door is the highest-priority elopement signal.          |
| `window`       | `warn`     | Window-risk — approaching a window is concerning but is less immediately actionable than a door event. |

`opening` connectors are excluded from auto-provisioning; they represent
architecturally open passageways with no physical barrier to monitor.

### 4. Auto-rule-per-connector (useConnectorProximityRule)

`useConnectorProximityRule` is a thin compositing hook that wraps
`useUpsertRoomConnector` + `useUpsertAlertRule` / `useDeleteAlertRule`:

- **Create**: connector INSERT → rule INSERT (door/window only; opening skipped).
  Rule failure after connector success logs a warning but does not roll back the
  connector (the caregiver can add the rule manually via Alerts settings).
- **Delete**: rule DELETE first → connector DELETE. If rule delete fails, the
  connector is NOT deleted (avoids orphan references). A toast surfaces the
  error.
- **Update radius**: queries the paired rule by `params->>'connector_id'`, then
  upserts `params.radius_m`.

The `cooldown_seconds` default is 300 s (5 minutes) to prevent alert fatigue
from a patient who lingers near a doorway.

---

## Rendering

### Editor (PlaceWorkspace → FloorPlanCanvas)

Zones render as SVG `<polygon>` elements in the existing `roomsLayerRef` SVG
overlay, drawn **before** the connector segment line so the line remains
visible on top:

- Door zone: `fill=#ef4444` at 12% opacity, `stroke=#ef4444` at 40% opacity,
  dashed (`4 3`).
- Window zone: `fill=#f59e0b` at 12% opacity, `stroke=#f59e0b` at 40% opacity,
  dashed (`4 3`).

The four corners are computed in screen space from the world-pixel endpoints and
the current viewport zoom (`vt[0]`), so the zone scales correctly with pan/zoom.

`RoomConnectorSprite.proximityRadiusPx` carries the world-pixel radius (derived
from `radius_m / scale_meters_per_pixel`). When omitted (opening connectors,
or no scale set), the zone is not rendered.

### Live view (LivePositionView)

Identical rendering via the same `FloorPlanCanvas` canvas. `useAlertRules` is
fetched and the `connector_id → radius_m` map is built in the connectors
useEffect.

---

## Test coverage

| File                                          | Tests added                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/test/rules/roomAndDoor.test.ts` | 15 new tests: `pointInSegmentRect` (7) + `evaluateRule door_proximity shape=rectangle` (4) + unchanged default shape (1) |

Existing tests for `evaluateRule — door_proximity` (5 tests covering the
segment path) are unmodified and still pass.

---

## What was NOT done / needs human review

1. **No DB migration** — `shape` is a new optional field in the JSONB `params`
   column. The Zod schema accepts and ignores it on old rules (the field is
   `optional()`), and the DB has no constraint on JSONB structure. No migration
   is needed.

2. **No back-fill of existing connectors** — Connectors placed before this
   feature landed will not have a paired rule. Caregivers must delete and
   re-add them, or create rules manually via Alerts settings, to gain proximity
   alerts. A future migration script could auto-provision missing rules.

3. **Canvas zone rendering after pan/zoom** — The SVG overlay is rebuilt in
   `renderRoomsAndConnectors()`, which is called on each `canvas.requestRenderAll`.
   This is the same pattern as rooms/connectors. However, the zone corners are
   computed in screen space using `vt[0]` at render time. If pan/zoom happens
   without a `requestRenderAll` (e.g., from a direct DOM scroll), zones would
   briefly be out of sync. This is the same pre-existing limitation as the
   room polygon overlay; not introduced here.

4. **`useConnectorProximityRule` supabase direct query** — `findPairedRule`
   does a direct `supabase.from('alert_rules')` query (not through the React
   Query cache) because it's called imperatively from mutation handlers. This
   bypasses the cache but is correct. A future refactor could expose a
   `queryFn` variant.
