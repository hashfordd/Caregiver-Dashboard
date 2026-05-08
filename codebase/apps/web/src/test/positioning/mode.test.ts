import { describe, it, expect } from 'vitest';
import { decideMode } from '@alzcare/shared/positioning';
import type { RecentEstimate } from '@alzcare/shared/positioning';
import type { GpsFix } from '@alzcare/shared/mqtt';

const STRONG_GPS: GpsFix = { lat: 0, lng: 0, hdop: 1.0, fix_age_s: 1 };
const WEAK_HDOP_GPS: GpsFix = { lat: 0, lng: 0, hdop: 5.0, fix_age_s: 1 };
const STALE_GPS: GpsFix = { lat: 0, lng: 0, hdop: 1.0, fix_age_s: 30 };

const NO_RECENT: RecentEstimate[] = [];

/** Build a synthetic prior row carrying the candidate signals. */
function priorRow(opts: {
  mode: 'indoor' | 'outdoor';
  gpsStrong: boolean | null;
  indoorConfidence: number | null;
}): RecentEstimate {
  return {
    recorded_at: '2026-05-06T10:00:00Z',
    mode: opts.mode,
    x_canvas: null,
    y_canvas: null,
    confidence: null,
    gps_strong: opts.gpsStrong,
    indoor_confidence: opts.indoorConfidence,
  };
}

describe('decideMode (POS-08 hysteresis: candidate-driven)', () => {
  it('with no history, holds at indoor when there is no GPS fix', () => {
    const out = decideMode({
      recentEstimates: NO_RECENT,
      gpsFix: undefined,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
    expect(out.gpsStrong).toBe(false);
    expect(out.indoorConfidence).toBe(0.1);
  });

  it('Phase G item 55: with no history, flips immediately on a cold-start outdoor candidate', () => {
    // Pre-fix behaviour: held at indoor for the first ~5 s of an
    // outdoor cold-start, persisting bogus indoor canvas coords.
    // With the cold-start exception, hysteresis defers to the current
    // tick when there are no priors to gather evidence from.
    const out = decideMode({
      recentEstimates: NO_RECENT,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('outdoor');
    expect(out.gpsStrong).toBe(true);
  });

  it('Phase G item 55: with no history and a neutral candidate, defaults to indoor', () => {
    const out = decideMode({
      recentEstimates: NO_RECENT,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.9, // strong indoor + strong GPS = neutral
    });
    expect(out.mode).toBe('indoor');
  });

  it('flips to outdoor on the 5th consecutive outdoor candidate', () => {
    const priors: RecentEstimate[] = Array.from({ length: 4 }, () =>
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.1 }),
    );
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('outdoor');
  });

  it('does NOT flip on only 4 consecutive outdoor candidates', () => {
    const priors: RecentEstimate[] = Array.from({ length: 3 }, () =>
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.1 }),
    );
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
  });

  it('breaks the consecutive run on a single non-matching tick (e.g. neutral classification)', () => {
    const priors: RecentEstimate[] = [
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.1 }),
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.9 }), // neutral (indoor strong)
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.1 }),
      priorRow({ mode: 'indoor', gpsStrong: true, indoorConfidence: 0.1 }),
    ];
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
  });

  it('once outdoor, flips back to indoor only after 5 consecutive GPS-lost ticks', () => {
    const priorsFor = (count: number): RecentEstimate[] =>
      Array.from({ length: count }, () =>
        priorRow({ mode: 'outdoor', gpsStrong: false, indoorConfidence: 0.1 }),
      );
    // 4 prior GPS-lost ticks + current GPS-lost tick = 5 → flips back.
    const out5 = decideMode({
      recentEstimates: priorsFor(4),
      gpsFix: undefined,
      indoorConfidence: 0.1,
    });
    expect(out5.mode).toBe('indoor');

    // Only 3 prior + current = 4 → still outdoor.
    const out4 = decideMode({
      recentEstimates: priorsFor(3),
      gpsFix: undefined,
      indoorConfidence: 0.1,
    });
    expect(out4.mode).toBe('outdoor');
  });

  it('weak-hdop GPS counts as not-strong, so it can produce indoor candidates after an outdoor flip', () => {
    const priors: RecentEstimate[] = Array.from({ length: 4 }, () =>
      priorRow({ mode: 'outdoor', gpsStrong: false, indoorConfidence: 0.1 }),
    );
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: WEAK_HDOP_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
  });

  it('stale-fix GPS also counts as not-strong', () => {
    const priors: RecentEstimate[] = Array.from({ length: 4 }, () =>
      priorRow({ mode: 'outdoor', gpsStrong: false, indoorConfidence: 0.1 }),
    );
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: STALE_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
  });

  it('legacy null-candidate priors degrade gracefully (treated as neutral, no flip)', () => {
    const priors: RecentEstimate[] = Array.from({ length: 8 }, () =>
      priorRow({ mode: 'indoor', gpsStrong: null, indoorConfidence: null }),
    );
    const out = decideMode({
      recentEstimates: priors,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.1,
    });
    expect(out.mode).toBe('indoor');
  });

  it('echoes back the candidate signals so the orchestrator can persist them', () => {
    const out = decideMode({
      recentEstimates: NO_RECENT,
      gpsFix: STRONG_GPS,
      indoorConfidence: 0.42,
    });
    expect(out.indoorConfidence).toBe(0.42);
    expect(out.gpsStrong).toBe(true);
  });
});
