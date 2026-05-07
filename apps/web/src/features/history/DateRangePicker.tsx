import { useEffect, useState } from 'react';
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
  const [customFrom, setCustomFrom] = useState(() => toLocalInput(value.from));
  const [customTo, setCustomTo] = useState(() => toLocalInput(value.to));

  // Keep the inputs in sync when an outside change shifts the range
  // (e.g. switching presets pushes recomputed bounds back here).
  useEffect(() => {
    setCustomFrom(toLocalInput(value.from));
    setCustomTo(toLocalInput(value.to));
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
    const fromIso = fromLocalInput(customFrom);
    const toIso = fromLocalInput(customTo);
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
    </div>
  );
}

// `<input type="datetime-local">` works in the browser's local timezone
// with no offset suffix; the date-range stores ISO 8601 UTC, so we
// translate at the boundary.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
