import { describe, it, expect, vi } from 'vitest';
import { createPairingResolver, normalizeMac, type PairingFetch } from '../lib/pairing.ts';
import type { Mapping } from '../lib/transform.ts';

const MAP: Mapping = {
  patient_id: '11111111-1111-1111-1111-111111111111',
  device_id: '22222222-2222-2222-2222-222222222222',
};

describe('normalizeMac', () => {
  it('lowercases + trims a well-formed MAC (matches dashboard storage)', () => {
    expect(normalizeMac('  AA:BB:CC:DD:EE:FF ')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('rejects non-MAC strings and non-strings', () => {
    expect(normalizeMac('not-a-mac')).toBeNull();
    expect(normalizeMac('aa:bb:cc:dd:ee')).toBeNull(); // too short
    expect(normalizeMac(undefined)).toBeNull();
    expect(normalizeMac(123)).toBeNull();
  });
});

describe('createPairingResolver', () => {
  it('caches a hit so repeated lookups hit the DB once', async () => {
    const fetch = vi.fn<PairingFetch>().mockResolvedValue(MAP);
    const r = createPairingResolver(fetch);

    expect(await r.resolve('aa:bb:cc:dd:ee:ff')).toEqual(MAP);
    expect(await r.resolve('aa:bb:cc:dd:ee:ff')).toEqual(MAP);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-checks the DB after the hit TTL expires (picks up a re-pairing)', async () => {
    let t = 0;
    const fetch = vi.fn<PairingFetch>().mockResolvedValue(MAP);
    const r = createPairingResolver(fetch, { hitTtlMs: 1000, now: () => t });

    await r.resolve('aa:bb:cc:dd:ee:ff');
    t = 1500; // past the hit TTL
    await r.resolve('aa:bb:cc:dd:ee:ff');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches a miss (shorter) so an unpaired device is re-checked soon after', async () => {
    let t = 0;
    const fetch = vi.fn<PairingFetch>().mockResolvedValueOnce(null).mockResolvedValue(MAP);
    const r = createPairingResolver(fetch, { missTtlMs: 500, now: () => t });

    expect(await r.resolve('aa:bb:cc:dd:ee:ff')).toBeNull(); // unpaired
    expect(await r.resolve('aa:bb:cc:dd:ee:ff')).toBeNull(); // still cached miss
    expect(fetch).toHaveBeenCalledTimes(1);

    t = 600; // past the miss TTL — now paired
    expect(await r.resolve('aa:bb:cc:dd:ee:ff')).toEqual(MAP);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent lookups for the same MAC into one DB call', async () => {
    let resolveFetch!: (m: Mapping | null) => void;
    const fetch = vi.fn<PairingFetch>().mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );
    const r = createPairingResolver(fetch);

    const a = r.resolve('aa:bb:cc:dd:ee:ff');
    const b = r.resolve('aa:bb:cc:dd:ee:ff');
    resolveFetch(MAP);

    expect(await a).toEqual(MAP);
    expect(await b).toEqual(MAP);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
