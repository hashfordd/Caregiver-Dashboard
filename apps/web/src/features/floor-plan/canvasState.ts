// Pure helpers for floor plan canvas state. No React, no DOM. The
// serialize / deserialize wrappers exist so the editor + tests can talk
// about a single contract independent of Fabric internals.

/**
 * Compute the meters-per-pixel ratio implied by a measured line.
 *
 * @param pixelLength euclidean length of the line in canvas pixels
 * @param metresEntered the real-world length the caregiver typed
 * @returns scale_meters_per_pixel as a positive finite number
 * @throws when either input is non-finite, zero, or negative
 */
export function computeScale(pixelLength: number, metresEntered: number): number {
  if (!Number.isFinite(pixelLength) || pixelLength <= 0) {
    throw new Error('pixel length must be a positive finite number');
  }
  if (!Number.isFinite(metresEntered) || metresEntered <= 0) {
    throw new Error('metres must be a positive finite number');
  }
  return metresEntered / pixelLength;
}

/**
 * Format a meters-per-pixel ratio as the more readable "1 px = X m" or
 * (when below 1 cm/px) "1 px = X cm".
 */
export function formatScale(metersPerPixel: number | null): string {
  if (metersPerPixel == null || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return 'No scale set';
  }
  if (metersPerPixel >= 0.01) {
    return `1 px = ${metersPerPixel.toFixed(3)} m`;
  }
  return `1 px = ${(metersPerPixel * 100).toFixed(2)} cm`;
}

/** True when the deserialised JSON looks like a valid Fabric canvas blob. */
export function isCanvasJson(value: unknown): value is { objects: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'objects' in value &&
    Array.isArray((value as { objects: unknown }).objects)
  );
}
