import { useEffect, useState } from 'react';
import { APP_TIMEZONE } from '@alzcare/shared';
import { cn } from '@/lib/utils';
import { computeRange, type DateRange, type RangePreset } from './types';

interface Props {
  value: DateRange;
  onChange: (next: DateRange) => void;
  /** Subset of presets to expose. Defaults to the F13 spec set
   *  (1h/6h/24h/7d/custom). Sub-tabs that only care about a smaller
   *  window can constrain the chip set. */
  presets?: RangePreset[];
}

const ALL_PRESETS: RangePreset[] = ['1h', '6h', '24h', '7d', 'custom'];
const LABELS: Record<RangePreset, string> = {
  '1h': '1 h',
  '6h': '6 h',
  '24h': '24 h',
  '7d': '7 d',
  custom: 'Custom',
};

export function DateRangePicker({ value, onChange, presets = ALL_PRESETS }: Props) {
  const [customFrom, setCustomFrom] = useState(() => toAppTzInput(value.from));
  const [customTo, setCustomTo] = useState(() => toAppTzInput(value.to));

  // Keep the inputs in sync when an outside change shifts the range
  // (e.g. switching presets pushes recomputed bounds back here).
  useEffect(() => {
    setCustomFrom(toAppTzInput(value.from));
    setCustomTo(toAppTzInput(value.to));
  }, [value.from, value.to]);

  const selectPreset = (preset: RangePreset) => {
    if (preset === 'custom') {
      onChange({ ...value, preset });
      return;
    }
    const { from, to } = computeRange(preset, Date.now());
    onChange({ preset, from, to });
  };

  const applyCustom = () => {
    const fromIso = fromAppTzInput(customFrom);
    const toIso = fromAppTzInput(customTo);
    if (!fromIso || !toIso) return;
    onChange({ preset: 'custom', from: fromIso, to: toIso });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Range preset" className="flex flex-wrap gap-1">
        {presets.map((preset) => {
          const active = value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {LABELS[preset]}
            </button>
          );
        })}
      </div>
      {value.preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card/50 px-2 py-1">
          <label className="text-[11px] text-muted-foreground">
            From
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="ml-1 rounded-sm border border-border bg-background px-1 py-0.5 text-xs text-foreground"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            To
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="ml-1 rounded-sm border border-border bg-background px-1 py-0.5 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-primary/20"
          >
            Apply
          </button>
        </div>
      )}
      <span
        className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
        aria-label="Times shown in Australian Eastern time"
      >
        AEST
      </span>
    </div>
  );
}

// `<input type="datetime-local">` works in the browser's local timezone
// with no offset suffix. The application's canonical timezone is AEST
// (APP_TIMEZONE = Australia/Sydney), so we translate at the boundary:
// ISO 8601 UTC ↔ AEST wall-clock string accepted by datetime-local.

function toAppTzInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  // en-CA emits dates as YYYY-MM-DD which is exactly what datetime-local
  // needs. Hour can be '24' for midnight in some impls — normalise.
  const hour = lookup.hour === '24' ? '00' : (lookup.hour ?? '00');
  return `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}`;
}

function fromAppTzInput(value: string): string | null {
  if (!value) return null;
  // Walk-clock string in AEST → UTC ISO. The datetime-local string has
  // no timezone marker; we reconstruct the UTC instant by looking up
  // AEST's offset at that wall-clock time (offset varies with DST).
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [_, y, mo, d, h, mi] = m;
  // Construct a UTC instant guess and ask Intl for AEST's offset at
  // that instant; correct the guess by that offset.
  const utcGuessMs = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!);
  const offsetMs = appTzOffsetMs(utcGuessMs);
  const trueMs = utcGuessMs - offsetMs;
  const result = new Date(trueMs);
  if (Number.isNaN(result.getTime())) return null;
  return result.toISOString();
}

function appTzOffsetMs(epochMs: number): number {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const hour = lookup.hour === '24' ? '00' : (lookup.hour ?? '00');
  const tzMs = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(hour),
    Number(lookup.minute),
    Number(lookup.second ?? '0'),
  );
  return tzMs - epochMs;
}
