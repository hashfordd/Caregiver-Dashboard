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
  | {
      kind: 'signals';
      persisted: false;
      reason: 'broadcast' | 'broadcast-failed' | 'validation';
      details?: string;
    }
  | { kind: 'events'; persisted: false; reason: 'phase-4' | 'validation'; details?: string }
  | { kind: 'unknown'; persisted: false; error: 'topic'; details: string };

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
    channel = supabase.channel(`patient:${patientId}:signals`);
    channel.subscribe();
    perClient.set(patientId, channel);
  }
  return channel;
}

export async function processMessage(
  topic: string,
  message: unknown,
  supabase: SupabaseClient,
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

  if (parsed.kind === 'telemetry') {
    const validation = TelemetryMessage.safeParse(message);
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
    const validation = SignalsMessage.safeParse(message);
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
    return { kind: 'signals', persisted: false, reason: 'broadcast' };
  }

  if (parsed.kind === 'events') {
    const validation = EventMessage.safeParse(message);
    if (!validation.success) {
      return {
        kind: 'events',
        persisted: false,
        reason: 'validation',
        details: validation.error.message,
      };
    }
    // TODO: F11 — events table insert and rules_engine fanout.
    return { kind: 'events', persisted: false, reason: 'phase-4' };
  }

  return { kind: 'unknown', persisted: false, error: 'topic', details: 'unhandled kind' };
}
