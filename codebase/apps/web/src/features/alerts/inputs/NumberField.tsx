import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clampToRange } from './clamp';

export interface NumberPreset {
  label: string;
  value: number;
}

export interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Short unit shown inside the field (e.g. "min", "s", "m", "bpm"). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** One-line plain-language helper under the label. */
  description?: string;
  /** Allow the field to be cleared to null — for one-sided ranges (vitals). */
  allowEmpty?: boolean;
  placeholder?: string;
  /** Quick-pick chips that set a common value. */
  presets?: NumberPreset[];
  invalid?: boolean;
}

/** Labelled numeric input with ± steppers, an in-field unit, min/max clamping,
 *  optional plain-language description, and quick-pick preset chips. Replaces
 *  the bare <input type=number> fields across the alert rule cards so a
 *  non-technical caregiver can fill them confidently.
 *
 *  Typing is left unclamped (so part-typed values like "1" before "12" aren't
 *  fought); clamping happens on blur, stepper, and preset. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  description,
  allowEmpty = false,
  placeholder,
  presets,
  invalid = false,
}: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => value?.toString() ?? '');
  const [focused, setFocused] = useState(false);

  // Resync the text from the external value only when the field isn't being
  // edited, so a clamp/preset/external update reflects but live typing doesn't
  // get clobbered.
  useEffect(() => {
    if (!focused) setText(value?.toString() ?? '');
  }, [value, focused]);

  function commit(raw: string) {
    if (raw.trim() === '') {
      onChange(allowEmpty ? null : clampToRange(min ?? 0, min, max));
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      onChange(allowEmpty ? null : value);
      return;
    }
    onChange(clampToRange(n, min, max));
  }

  function set(next: number) {
    const clamped = clampToRange(next, min, max);
    setText(clamped.toString());
    onChange(clamped);
  }

  function adjust(direction: 1 | -1) {
    const base = value ?? min ?? 0;
    set(base + direction * step);
  }

  const atMin = value != null && min != null && value <= min;
  const atMax = value != null && max != null && value >= max;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      {description && (
        <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
      )}
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => adjust(-1)}
          disabled={atMin}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="relative flex-1">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            placeholder={placeholder}
            value={text}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              const t = e.target.value;
              setText(t);
              if (t.trim() === '') {
                if (allowEmpty) onChange(null);
                return;
              }
              const n = Number(t);
              if (Number.isFinite(n)) onChange(n);
            }}
            onBlur={(e) => {
              setFocused(false);
              commit(e.target.value);
            }}
            className={cn(
              'h-9 w-full rounded-md border bg-background px-2 text-center text-sm tabular-nums',
              unit && 'pr-9',
              invalid ? 'border-destructive' : 'border-border',
            )}
          />
          {unit && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Increase"
          onClick={() => adjust(1)}
          disabled={atMax}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => set(p.value)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                value === p.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
