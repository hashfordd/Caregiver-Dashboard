import { describe, it, expect } from 'vitest';
import { TelemetryMessage, parseTopic } from '@alzcare/shared/mqtt';

describe('shared schemas reachable from edge workspace', () => {
  it('accepts a well-formed telemetry payload', () => {
    const result = TelemetryMessage.safeParse({
      v: 1,
      patient_id: '00000000-0000-0000-0000-000000000000',
      device_id: 'dev-1',
      recorded_at: new Date().toISOString(),
      hr_bpm: 72,
      spo2_pct: 98,
      temp_c: 36.5,
    });
    expect(result.success).toBe(true);
  });

  it('parses a telemetry topic correctly', () => {
    const topic = parseTopic('device/00000000-0000-0000-0000-000000000000/telemetry');
    expect(topic).toEqual({
      patient_id: '00000000-0000-0000-0000-000000000000',
      kind: 'telemetry',
    });
  });

  it('rejects a malformed topic', () => {
    expect(parseTopic('not/a/real/topic')).toBeNull();
    expect(parseTopic('device/not-a-uuid/telemetry')).toBeNull();
  });
});
