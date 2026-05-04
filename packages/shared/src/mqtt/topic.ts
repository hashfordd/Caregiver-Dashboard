import { z } from 'zod';

export const MqttTopicKind = z.enum(['telemetry', 'signals', 'events']);
export type MqttTopicKind = z.infer<typeof MqttTopicKind>;

const TOPIC_RE = /^device\/([0-9a-f-]{36})\/(telemetry|signals|events)$/i;

export interface ParsedTopic {
  patient_id: string;
  kind: MqttTopicKind;
}

export function buildTopic(patientId: string, kind: MqttTopicKind): string {
  return `device/${patientId}/${kind}`;
}

export function parseTopic(topic: string): ParsedTopic | null {
  const m = TOPIC_RE.exec(topic);
  if (!m || !m[1] || !m[2]) return null;
  const kind = MqttTopicKind.safeParse(m[2]);
  if (!kind.success) return null;
  return { patient_id: m[1], kind: kind.data };
}
