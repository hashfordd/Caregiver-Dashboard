/** Clamp a value into an optional [min, max] range. Non-finite values pass
 *  through unchanged so callers can still detect "empty / invalid" upstream. */
export function clampToRange(value: number, min?: number, max?: number): number {
  if (!Number.isFinite(value)) return value;
  let v = value;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}
