// Minimal MQTT topic-filter matcher (supports + single-level and # multi-level
// wildcards) so the shared client can fan a message out to the handlers whose
// filter matches. We mostly use exact topics, but + lets one subscription cover
// device/{id}/+ across telemetry/signals/events.
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    const seg = f[i];
    if (seg === '#') return true; // matches the rest, including zero levels
    if (seg === '+') {
      if (t[i] === undefined) return false;
      continue;
    }
    if (seg !== t[i]) return false;
  }
  return f.length === t.length;
}
