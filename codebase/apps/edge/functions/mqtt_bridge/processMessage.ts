// Shared persistence + validation core for the mqtt_bridge. Both the HTTP
// handler (./index.ts, the CI entry point) and the future long-running MQTT
// subscriber (Phase 1 closure work — see BACKLOG) call this single module.
// Keeping a single SSOT means CI exercises the same path firmware will hit
// in production. CROSS_CUTTING §11.

import { EventMessage, parseTopic, SignalsMessage, TelemetryMessage } from '@alzcare/shared/mqtt';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type ProcessOutcome =
  | { kind: 'telemetry'; persisted: true; rowId: string }
  | { kind: 'telemetry'; persisted: false; error: 'validation' | 'persistence'; details: string }
  | { kind: 'signals'; persisted: false; reason: 'broadcast'; signals: SignalsMessage }
  | {
      kind: 'signals';
      persisted: false;
      reason: 'broadcast-failed' | 'validation';
      details?: string;
    }
  | {
      kind: 'events';
      persisted: true;
      rowId: string;
      /** True when this delivery hit the idempotency index (the row already
       *  existed). The original INSERT already fired rules; callers that
       *  dispatch rules in-process (longRunning local-compute) MUST NOT
       *  re-dispatch on a deduped hit or one event yields duplicate alerts. */
      deduped?: boolean;
    }
  | {
      kind: 'events';
      persisted: false;
      error: 'validation' | 'persistence';
      details: string;
    }
  | { kind: 'unknown'; persisted: false; error: 'topic' | 'device'; details: string };

/** Bridge-side env passed in (rather than read directly) so tests can
 *  drive the position-estimator POST without setting Deno env vars. */
export interface BridgeEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

/** F8 invocation timeout. The bridge is fire-and-await so the warn
 *  surfaces in the same log stream as the originating signals payload,
 *  but the estimator should never block telemetry processing — 1500 ms
 *  is plenty for a healthy edge function (which does ~4 DB reads + a
 *  pure pipeline + 1 insert in <100 ms typical) and short enough that
 *  the next signals tick (~1 s away) still arrives on schedule. */
const POSITION_ESTIMATOR_TIMEOUT_MS = 1500;

// Per-patient broadcast-channel cache. Each call to supabase.channel(name)
// creates a new socket subscription; without caching, every signals
// message would leak a subscription. The bridge process holds these for
// its lifetime — long-running mode is one process per deploy, HTTP entry
// is one process per request worker, so the cache is bounded by patient
// count not by message volume.
const signalsChannelCache = new WeakMap<SupabaseClient, Map<string, RealtimeChannel>>();

function getSignalsChannel(supabase: SupabaseClient, patientId: string): RealtimeChannel {
  let perClient = signalsChannelCache.get(supabase);
  if (!perClient) {
    perClient = new Map();
    signalsChannelCache.set(supabase, perClient);
  }
  let channel = perClient.get(patientId);
  if (!channel) {
    // SEC-01: private channel so Realtime Authorization gates receivers.
    // The bridge authenticates its realtime socket with the service-role
    // JWT (see setAuth at client creation), which bypasses realtime RLS,
    // so sending is unaffected; only client *receipt* is now scoped by
    // the realtime.messages policy.
    channel = supabase.channel(`patient:${patientId}:signals`, {
      config: { private: true },
    });
    channel.subscribe();
    perClient.set(patientId, channel);
  }
  return channel;
}

export async function processMessage(
  topic: string,
  message: unknown,
  supabase: SupabaseClient,
  env?: BridgeEnv,
): Promise<ProcessOutcome> {
  const parsed = parseTopic(topic);
  if (!parsed) {
    return {
      kind: 'unknown',
      persisted: false,
      error: 'topic',
      details: `invalid topic: ${topic}`,
    };
  }

  // MAC-keyed topic (`device/{mac}/…`): the device only knows its own MAC.
  // Resolve it to its paired patient + device UUID and inject both, so the
  // rest of the pipeline is identical to a patient-keyed message. Pairing is
  // done in the dashboard (`pair_device`); an unknown/unpaired MAC is dropped.
  let payload = message;
  if (parsed.mac) {
    const { data: device, error } = await supabase
      .from('devices')
      .select('id, paired_patient_id')
      .eq('mac_address', parsed.mac)
      .maybeSingle();
    if (error) {
      return { kind: 'unknown', persisted: false, error: 'device', details: error.message };
    }
    if (!device) {
      return {
        kind: 'unknown',
        persisted: false,
        error: 'device',
        details: `no device paired with mac ${parsed.mac} — pair it in the dashboard first`,
      };
    }
    if (!device.paired_patient_id) {
      return {
        kind: 'unknown',
        persisted: false,
        error: 'device',
        details: `device ${parsed.mac} is not paired to a patient`,
      };
    }
    payload = {
      ...(typeof message === 'object' && message !== null ? message : {}),
      patient_id: device.paired_patient_id,
      device_id: device.id,
    };
  }

  if (parsed.kind === 'telemetry') {
    const validation = TelemetryMessage.safeParse(payload);
    if (!validation.success) {
      return {
        kind: 'telemetry',
        persisted: false,
        error: 'validation',
        details: validation.error.message,
      };
    }
    const m = validation.data;
    const { data, error } = await supabase
      .from('sensor_readings')
      .insert({
        patient_id: m.patient_id,
        device_id: m.device_id,
        recorded_at: m.recorded_at,
        hr_bpm: m.hr_bpm ?? null,
        spo2_pct: m.spo2_pct ?? null,
        temp_c: m.temp_c ?? null,
        accel: m.accel ?? null,
        gyro: m.gyro ?? null,
      })
      .select('id')
      .single();
    if (error || !data) {
      return {
        kind: 'telemetry',
        persisted: false,
        error: 'persistence',
        details: error?.message ?? 'no row returned',
      };
    }
    // F10: bump the device heartbeat. Best-effort — a failed update here
    // shouldn't fail the persist outcome (the telemetry row landed).
    const heartbeat = await supabase
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', m.device_id);
    if (heartbeat.error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'mqtt_bridge: heartbeat update failed',
          device_id: m.device_id,
          err: heartbeat.error.message,
        }),
      );
    }
    return { kind: 'telemetry', persisted: true, rowId: data.id };
  }

  if (parsed.kind === 'signals') {
    const validation = SignalsMessage.safeParse(payload);
    if (!validation.success) {
      return {
        kind: 'signals',
        persisted: false,
        reason: 'validation',
        details: validation.error.message,
      };
    }
    const m = validation.data;
    // F6: re-broadcast the validated message on patient:<id>:signals
    // (no DB write — Phase 2 design intentionally doesn't persist raw
    // signals; see PHASES.md Phase 3 "If the project later needs replay-
    // from-raw-signals"). The dashboard's usePatientStream subscribes to
    // this channel.
    const channel = getSignalsChannel(supabase, m.patient_id);
    try {
      const status = await channel.send({ type: 'broadcast', event: 'signals', payload: m });
      if (status !== 'ok') {
        return {
          kind: 'signals',
          persisted: false,
          reason: 'broadcast-failed',
          details: `realtime status: ${String(status)}`,
        };
      }
    } catch (err) {
      return {
        kind: 'signals',
        persisted: false,
        reason: 'broadcast-failed',
        details: (err as Error).message,
      };
    }
    // F8: fire-and-await the position_estimator. Failure here is
    // logged but doesn't change the outcome — the next signals payload
    // arrives in ~1 s, and telemetry must never block on positioning.
    // We await so warns are sequenced with the originating broadcast
    // in the log stream; the helper swallows its own errors.
    if (env != null) {
      await invokePositionEstimator(env, m);
    }
    return { kind: 'signals', persisted: false, reason: 'broadcast', signals: m };
  }

  if (parsed.kind === 'events') {
    const validation = EventMessage.safeParse(payload);
    if (!validation.success) {
      return {
        kind: 'events',
        persisted: false,
        error: 'validation',
        details: validation.error.message,
      };
    }
    const m = validation.data;
    // Phase G item 65: idempotent insert. The bridge can re-receive an event
    // (MQTT retry / replay-signals second pass / webhook redelivery) and a
    // naive INSERT would create a duplicate fall alert. Dedup is enforced by
    // the unique index events_idempotency_uidx (20260508120000), which is an
    // EXPRESSION index over coalesce(device_id, …), occurred_at, type,
    // coalesce(payload->>'idempotency_key', ''). PostgREST's onConflict only
    // accepts plain column names, so it cannot target an expression index —
    // we INSERT and treat a unique-violation (23505) as an idempotent hit,
    // re-fetching the existing row's id.
    const { data, error } = await supabase
      .from('events')
      .insert({
        patient_id: m.patient_id,
        device_id: m.device_id,
        occurred_at: m.occurred_at,
        type: m.type,
        payload: m.payload ?? {},
      })
      .select('id')
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        // Already persisted by an earlier delivery — the original insert's
        // webhook already fired rules_engine, so do NOT re-fire. Report the
        // existing row so a retry isn't surfaced as a false error.
        let dedupQuery = supabase
          .from('events')
          .select('id')
          .eq('occurred_at', m.occurred_at)
          .eq('type', m.type);
        dedupQuery =
          m.device_id == null
            ? dedupQuery.is('device_id', null)
            : dedupQuery.eq('device_id', m.device_id);
        const existing = await dedupQuery.limit(1).maybeSingle();
        if (existing.data) {
          return {
            kind: 'events',
            persisted: true,
            rowId: (existing.data as { id: string }).id,
            deduped: true,
          };
        }
      }
      return {
        kind: 'events',
        persisted: false,
        error: 'persistence',
        details: error?.message ?? 'no row returned',
      };
    }
    // Database webhook on events INSERT triggers rules_engine — no
    // direct invocation here. Fall rules fire from that path.
    return { kind: 'events', persisted: true, rowId: (data as { id: string }).id };
  }

  return { kind: 'unknown', persisted: false, error: 'topic', details: 'unhandled kind' };
}

/** Fire-and-await POST to the position_estimator. Wraps the fetch in
 *  AbortSignal.timeout so a slow estimator doesn't stall the bridge,
 *  and try/catches every failure mode (timeout, network, non-2xx) so
 *  the broadcast outcome is stable regardless of the estimator's state.
 *
 *  Errors emit a structured warn carrying the originating payload's
 *  patient_id + recorded_at so log scraping can correlate dropped
 *  estimates against the signal stream. */
async function invokePositionEstimator(
  env: BridgeEnv,
  message: { patient_id: string; recorded_at: string },
): Promise<void> {
  const url = `${env.supabaseUrl}/functions/v1/position_estimator`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.serviceRoleKey}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(POSITION_ESTIMATOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'mqtt_bridge: position_estimator non-2xx',
          status: res.status,
          patient_id: message.patient_id,
          recorded_at: message.recorded_at,
        }),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'mqtt_bridge: position_estimator failed',
        err: (err as Error).message ?? String(err),
        patient_id: message.patient_id,
        recorded_at: message.recorded_at,
      }),
    );
  }
}
