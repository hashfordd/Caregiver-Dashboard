// DB-driven device→patient pairing for the combined `.../total` dialect.
//
// The device carries its own MAC in the payload; the shim resolves that MAC to
// the patient + device UUIDs it was paired to in the dashboard, so adding a
// device is just "Pair device" in the app — no shim restart and no static
// flags. (This mirrors how the bridge resolves `device/{mac}/…` topics, but the
// combined device publishes patient-keyed canonical messages, so the shim does
// the resolution before re-publishing.)
//
// A short TTL cache keeps the per-message DB hit off the hot path while still
// picking up a fresh pairing within `hitTtlMs`. Misses are cached (shorter) too,
// so an unpaired device publishing every couple of seconds doesn't hammer the
// DB — and gets noticed within `missTtlMs` once you pair it.

import type { Mapping } from './transform.ts';

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/**
 * Lowercase + trim a MAC so it matches how the dashboard stores
 * `devices.mac_address` (PairDeviceDialog calls `.toLowerCase()`). Returns null
 * for anything that isn't a well-formed colon-delimited MAC.
 */
export function normalizeMac(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const mac = raw.trim().toLowerCase();
  return MAC_RE.test(mac) ? mac : null;
}

/** Looks up the paired patient/device for a MAC; null when unknown/unpaired. */
export type PairingFetch = (mac: string) => Promise<Mapping | null>;

export interface PairingResolverOptions {
  /** How long a successful resolution is trusted before re-checking the DB. */
  hitTtlMs?: number;
  /** How long a miss (unknown/unpaired MAC) is remembered before re-checking. */
  missTtlMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface PairingResolver {
  resolve(mac: string): Promise<Mapping | null>;
}

interface CacheEntry {
  value: Mapping | null;
  expires: number;
}

export function createPairingResolver(
  fetchByMac: PairingFetch,
  opts: PairingResolverOptions = {},
): PairingResolver {
  const hitTtl = opts.hitTtlMs ?? 30_000;
  const missTtl = opts.missTtlMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  // De-dupe concurrent lookups for the same MAC into one DB round-trip — the
  // device fires several messages per second, so without this a cold MAC would
  // launch a burst of identical queries.
  const inflight = new Map<string, Promise<Mapping | null>>();

  return {
    async resolve(mac: string): Promise<Mapping | null> {
      const cached = cache.get(mac);
      if (cached && cached.expires > now()) return cached.value;

      const pending = inflight.get(mac);
      if (pending) return pending;

      const p = (async () => {
        try {
          const value = await fetchByMac(mac);
          cache.set(mac, { value, expires: now() + (value ? hitTtl : missTtl) });
          return value;
        } finally {
          inflight.delete(mac);
        }
      })();
      inflight.set(mac, p);
      return p;
    },
  };
}
