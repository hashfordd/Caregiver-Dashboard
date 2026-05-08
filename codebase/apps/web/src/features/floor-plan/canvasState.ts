// Pure helpers for floor plan canvas state. No React, no DOM. The
// serialize / deserialize wrappers exist so the editor + tests can talk
// about a single contract independent of Fabric internals.

import { z } from 'zod';

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

/**
 * Phase F item 48: structural Zod schema for the persisted canvas blob.
 * Permissive on individual object shapes (Fabric serialises a wide
 * type set we don't want to enumerate), strict on the wrapper shape.
 *
 * `version` lives on the produced JSON whether we set it or Fabric's
 * default does, so it's required-with-default. `background` is whatever
 * Fabric writes — we don't validate.
 */
export const CanvasJsonSchema = z
  .object({
    version: z.string().optional(),
    objects: z.array(z.object({ type: z.string() }).passthrough()),
    background: z.unknown().optional(),
  })
  .passthrough();

export type CanvasJson = z.infer<typeof CanvasJsonSchema>;

export interface ParseCanvasJsonOk {
  ok: true;
  json: CanvasJson;
}
export interface ParseCanvasJsonErr {
  ok: false;
  error: string;
}

/**
 * Validate persisted canvas JSON before handing it to Fabric's
 * `loadFromJSON`. Fabric will fail-loud on a deeply malformed blob,
 * but the failure mode is "blank canvas with a console error" — this
 * Zod gate surfaces the failure to the editor (caller) so it can show
 * a toast and fall back to an empty canvas with no surprises.
 */
export function parseCanvasJson(value: unknown): ParseCanvasJsonOk | ParseCanvasJsonErr {
  const result = CanvasJsonSchema.safeParse(value);
  if (result.success) return { ok: true, json: result.data };
  // Surface only the first issue — reading 5 nested error paths is
  // unhelpful when the editor is going to fall back anyway.
  const issue = result.error.issues[0];
  const path = issue?.path?.join('.') ?? '<root>';
  const msg = issue?.message ?? 'invalid canvas JSON';
  return { ok: false, error: `${path}: ${msg}` };
}
