import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import type { AlertRule } from '@alzcare/shared';
import { previewRule } from './previewRule';
import { usePreviewWindow } from './usePreviewWindow';

interface RulePreviewProps {
  rule: AlertRule;
}

/** Item 158: tiny debounced-value hook so polygon/textarea keystrokes
 *  don't fire the preview evaluator on every char. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

/** "Would have alerted in last 24 h" surface. Runs the same evaluator
 *  the engine uses against the patient's last 24 h of stored data, with
 *  per-rule cooldown tracked in the same way. The hits count is what
 *  the engine would have written to alerts; the per-severity breakdown
 *  matches the badge colours in the live feed.
 *
 *  Pure-function preview — never inserts anything. The rule prop is
 *  debounced 250 ms so editor keystrokes (zone polygon JSON, vitals
 *  number inputs) don't run the 24 h evaluator on every char. */
export function RulePreview({ rule }: RulePreviewProps) {
  const { patientId } = usePatientStreamContext();
  const window = usePreviewWindow(patientId);
  const debouncedRule = useDebouncedValue(rule, 250);

  const result = useMemo(() => {
    if (!window.data) return null;
    return previewRule({
      rule: debouncedRule,
      sensors: window.data.sensors,
      positions: window.data.positions,
      events: window.data.events,
      now: window.data.now,
    });
  }, [debouncedRule, window.data]);

  if (window.isLoading) {
    return (
      <span className="flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Computing preview against the last 24 hours…
      </span>
    );
  }
  if (window.isError || !result) {
    return <span className="text-destructive">Couldn't compute preview.</span>;
  }
  if (result.hits.length === 0) {
    return <span>Would not have fired in the last 24 hours.</span>;
  }
  return (
    <div className="space-y-1">
      <div>
        Would have fired <strong>{result.hits.length}</strong> time
        {result.hits.length === 1 ? '' : 's'} in the last 24 hours.
      </div>
      <div className="flex gap-3 text-[10px]">
        {result.byseverity.critical > 0 && (
          <span className="text-red-700 dark:text-red-300">
            critical: {result.byseverity.critical}
          </span>
        )}
        {result.byseverity.warn > 0 && (
          <span className="text-amber-700 dark:text-amber-300">warn: {result.byseverity.warn}</span>
        )}
        {result.byseverity.info > 0 && (
          <span className="text-sky-700 dark:text-sky-300">info: {result.byseverity.info}</span>
        )}
      </div>
    </div>
  );
}
