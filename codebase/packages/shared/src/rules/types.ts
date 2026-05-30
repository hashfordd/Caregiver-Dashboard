// F11: shared rule contracts. The `AlertRule` discriminated union mirrors
// the `alert_rules.params` JSONB shape per `type`. Owned here so the
// rules engine, the preview, and the UI all agree on the same shape —
// drift between the engine and the preview is the failure mode the
// CROSS_CUTTING §10 parity test guards against.
//
// V1 ships four rule types: zone, vitals, fall, inactivity. The
// repetitive_movement enum value exists in the migration but no card or
// evaluator branch ships in V1; the BACKLOG records the deferral.
//
// Phase C: zone rules now discriminate on `space` to distinguish indoor
// canvas polygons (floor-plan x_canvas/y_canvas) from outdoor geofences
// (lat/lng GeoJSON). The two UIs (alerts/ZoneRuleCard and map/Outdoor
// geofence editor) write to the same `alert_rules` row with `type='zone'`
// but supply different `params` shapes; the evaluator dispatches on
// `params.space`.

import { z } from 'zod';
import type { AlertSeverity } from '../db/alerts.ts';
import type { EventRow, PositionEstimateRow, SensorReadingRow } from '../db/index.ts';
import { GeofencePolygon } from './geofence.ts';

// ─── per-rule param shapes (Zod for runtime validation in the UI) ────

// Indoor zone: floor-plan canvas-pixel polygon. Patient must have
// `position_estimate.mode === 'indoor'` and a non-null x_canvas/y_canvas.
export const IndoorZoneParams = z.object({
  space: z.literal('indoor'),
  /** Polygon in canvas coords: [[x_canvas, y_canvas], ...].
   *  Closed implicitly (no need to repeat the first vertex at the end). */
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  /** 'enter' fires on entering; 'exit' fires on leaving. */
  direction: z.enum(['enter', 'exit']),
  /** Seconds the condition must hold continuously before firing. 0 = immediate. */
  dwell_seconds: z.number().int().nonnegative(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type IndoorZoneParams = z.infer<typeof IndoorZoneParams>;

// Outdoor zone: GeoJSON-ordered (lng, lat) polygon. Patient must have
// `position_estimate.mode === 'outdoor'` and non-null lat/lng.
export const OutdoorZoneParams = z.object({
  space: z.literal('outdoor'),
  geofence: GeofencePolygon,
  direction: z.enum(['enter', 'exit']),
  /** Seconds the condition must hold continuously before firing. 0 = immediate. */
  dwell_seconds: z.number().int().nonnegative().default(0),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type OutdoorZoneParams = z.infer<typeof OutdoorZoneParams>;

export const ZoneParams = z.discriminatedUnion('space', [IndoorZoneParams, OutdoorZoneParams]);
export type ZoneParams = z.infer<typeof ZoneParams>;

const VitalsParams = z.object({
  metric: z.enum(['hr_bpm', 'spo2_pct', 'temp_c']),
  /** Inclusive bounds. Either may be null for a one-sided range. */
  min: z.number().nullable(),
  max: z.number().nullable(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type VitalsParams = z.infer<typeof VitalsParams>;

const FallParams = z.object({
  cooldown_seconds: z.number().int().positive().optional(),
});
export type FallParams = z.infer<typeof FallParams>;

const InactivityParams = z.object({
  inactive_minutes: z.number().int().positive(),
  /** Optional time-of-day window evaluated in AEST (Australia/Sydney);
   *  fires only when 'now' falls inside the window. HH:mm-HH:mm form. */
  only_between: z.object({ from: z.string(), to: z.string() }).optional(),
  /** Canvas-pixel distance below which a position change does not count
   *  as motion. Defaults to MOTION_FLOOR_PX in evaluate.ts. */
  motion_floor_px: z.number().nonnegative().optional(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type InactivityParams = z.infer<typeof InactivityParams>;

// Item 131: device_silence — fires when the patient's wearable hasn't
// reported in `silence_minutes`. Distinct from inactivity (which is
// "patient not moving but device reporting"); same patient surface,
// different sensor expectation.
const DeviceSilenceParams = z.object({
  silence_minutes: z.number().int().positive(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type DeviceSilenceParams = z.infer<typeof DeviceSilenceParams>;

// Phase C: room_transition — fires when a position estimate enters or
// leaves a specific `rooms.id` polygon. Distinct from the inline-polygon
// `zone` rule because editing the room's shape doesn't require
// re-saving the rule. The room is resolved by the rules engine at
// evaluate time from the rooms table.
export const RoomTransitionParams = z.object({
  room_id: z.string().uuid(),
  direction: z.enum(['enter', 'exit']),
  /** Seconds the condition must hold continuously before firing. */
  dwell_seconds: z.number().int().nonnegative(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type RoomTransitionParams = z.infer<typeof RoomTransitionParams>;

// Phase C: door_proximity — fires when a position estimate sits within
// `radius_m` of a specific `room_connectors.id` segment for
// `dwell_seconds`. Captures "approaching the door" semantics. The
// evaluator converts radius to canvas pixels using the floor plan's
// scale_meters_per_pixel passed in via HistoryWindow.
export const DoorProximityParams = z.object({
  connector_id: z.string().uuid(),
  /** Real-world threshold in metres. The evaluator converts to canvas
   *  pixels using the floor plan's scale. */
  radius_m: z.number().positive(),
  /** Seconds the condition must hold continuously before firing. */
  dwell_seconds: z.number().int().nonnegative(),
  cooldown_seconds: z.number().int().positive().optional(),
  /** Proximity test shape:
   *  - 'segment' (default/undefined): original point-to-segment distance test.
   *  - 'rectangle': oriented rectangle expanded by radius_m on all four sides
   *    of the connector segment. Used by door/window proximity zones. */
  shape: z.enum(['segment', 'rectangle']).optional(),
});
export type DoorProximityParams = z.infer<typeof DoorProximityParams>;

// ─── union ────────────────────────────────────────────────────────────

interface AlertRuleBase {
  id: string;
  patient_id: string;
  severity: AlertSeverity;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoneRule extends AlertRuleBase {
  type: 'zone';
  params: ZoneParams;
}
export interface VitalsRule extends AlertRuleBase {
  type: 'vitals';
  params: VitalsParams;
}
export interface FallRule extends AlertRuleBase {
  type: 'fall';
  params: FallParams;
}
export interface InactivityRule extends AlertRuleBase {
  type: 'inactivity';
  params: InactivityParams;
}
export interface DeviceSilenceRule extends AlertRuleBase {
  type: 'device_silence';
  params: DeviceSilenceParams;
}
export interface RoomTransitionRule extends AlertRuleBase {
  type: 'room_transition';
  params: RoomTransitionParams;
}
export interface DoorProximityRule extends AlertRuleBase {
  type: 'door_proximity';
  params: DoorProximityParams;
}

export type AlertRule =
  | ZoneRule
  | VitalsRule
  | FallRule
  | InactivityRule
  | DeviceSilenceRule
  | RoomTransitionRule
  | DoorProximityRule;
export type AlertRuleType = AlertRule['type'];

/** Zod parser keyed off the rule's `type` field. Used by the UI on save
 *  and by the rules engine when it loads rule rows from the DB
 *  (defensive — the JSONB column is untyped at the storage layer). */
export const AlertRuleParams = z.discriminatedUnion('type', [
  z.object({ type: z.literal('zone'), params: ZoneParams }),
  z.object({ type: z.literal('vitals'), params: VitalsParams }),
  z.object({ type: z.literal('fall'), params: FallParams }),
  z.object({ type: z.literal('inactivity'), params: InactivityParams }),
  z.object({ type: z.literal('device_silence'), params: DeviceSilenceParams }),
  z.object({ type: z.literal('room_transition'), params: RoomTransitionParams }),
  z.object({ type: z.literal('door_proximity'), params: DoorProximityParams }),
]);

// AlertSeverity is re-exported from db/alerts via the package barrel.

// ─── evaluator IO ─────────────────────────────────────────────────────

/** The data point that triggered the evaluation. Vitals/zone/fall fire
 *  on row INSERT; inactivity fires on a scheduled tick. */
export type DataPoint =
  | { kind: 'sensor_reading'; row: SensorReadingRow }
  | { kind: 'position_estimate'; row: PositionEstimateRow }
  | { kind: 'event'; row: EventRow }
  | { kind: 'tick'; at: string };

/** Caller-loaded history. Each rule type uses what it needs:
 *  - zone: `positions` for dwell-time confirmation.
 *  - inactivity: `positions` to find the last motion.
 *  - vitals/fall: history is unused — they're per-row stateless.
 *  - room_transition: `positions` for dwell + `rooms` for the polygon.
 *  - door_proximity: `positions` for dwell + `roomConnectors` for the
 *    segment + `scaleMetersPerPixel` to convert the radius. */
export interface HistoryWindow {
  positions: PositionEstimateRow[];
  sensors: SensorReadingRow[];
  events: EventRow[];
  /** Phase C: keyed by rooms.id. The rules engine pre-fetches the
   *  patient's active floor plan's rooms so the evaluator can resolve
   *  `room_transition` rules without a DB call per evaluation. */
  rooms?: Record<string, { polygon_canvas: [number, number][] }>;
  /** Phase C: keyed by room_connectors.id. */
  roomConnectors?: Record<
    string,
    { start_x: number; start_y: number; end_x: number; end_y: number }
  >;
  /** Phase C: floor plan scale, used to convert `door_proximity.radius_m`
   *  into canvas pixels for the distance check. */
  scaleMetersPerPixel?: number;
}

export type EvaluatorResult =
  | { fire: true; severity: AlertSeverity; context: Record<string, unknown> }
  | { fire: false };
