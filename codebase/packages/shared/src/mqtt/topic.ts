import { z } from 'zod';

export const MqttTopicKind = z.enum(['telemetry', 'signals', 'events']);
export type MqttTopicKind = z.infer<typeof MqttTopicKind>;

// The device identifier segment is either a patient UUID (caller already knows
// the patient) or a device MAC (firmware only knows its own MAC — the bridge
// resolves the MAC to its paired patient + device UUID).
const TOPIC_RE = /^device\/([^/]+)\/(telemetry|signals|events)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export interface ParsedTopic {
  /** Patient UUID when keyed by patient (`device/{uuid}/…`); null for MAC topics. */
  patient_id: string | null;
  /** Device MAC when keyed by device (`device/{mac}/…`); the bridge resolves it
   *  to a patient + device UUID. Null for patient-UUID topics. */
  mac: string | null;
  kind: MqttTopicKind;
}

/** Build a patient-keyed topic (`device/{patient_uuid}/{kind}`). */
export function buildTopic(patientId: string, kind: MqttTopicKind): string {
  return `device/${patientId}/${kind}`;
}

/** Build a device-MAC-keyed topic (`device/{mac}/{kind}`); the bridge resolves
 *  the MAC to its paired patient. Firmware only needs to know its own MAC. */
export function buildDeviceTopic(mac: string, kind: MqttTopicKind): string {
  return `device/${mac.toLowerCase()}/${kind}`;
}

export function parseTopic(topic: string): ParsedTopic | null {
  const m = TOPIC_RE.exec(topic);
  if (!m || !m[1] || !m[2]) return null;
  const kind = MqttTopicKind.safeParse(m[2]);
  if (!kind.success) return null;
  const id = m[1];
  if (UUID_RE.test(id)) return { patient_id: id.toLowerCase(), mac: null, kind: kind.data };
  if (MAC_RE.test(id)) return { patient_id: null, mac: id.toLowerCase(), kind: kind.data };
  return null;
}
