import { useMemo } from 'react';
import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AlertRule,
  DeviceSilenceRule,
  FallRule,
  InactivityRule,
  VitalsRule,
  ZoneRule,
} from '@alzcare/shared';
import { useAlertRules } from './useAlertRules';
import { DeviceSilenceRuleCard } from './rule-types/DeviceSilenceRuleCard';
import { FallRuleCard } from './rule-types/FallRuleCard';
import { InactivityRuleCard } from './rule-types/InactivityRuleCard';
import { VitalsRuleCard } from './rule-types/VitalsRuleCard';
import { ZoneRuleCard } from './rule-types/ZoneRuleCard';

interface Props {
  patientId: string;
}

/** F11 settings panel. Lays out one card per V1 rule type. Multiple
 *  vitals rules are common (HR + SpO₂ + temp); each metric gets its own
 *  card slot. Zone / fall / inactivity are single-instance per patient
 *  in V1; the BACKLOG records that multi-instance is a future tweak. */
export function RuleSettingsTab({ patientId }: Props) {
  const rules = useAlertRules(patientId);

  const grouped = useMemo(() => groupRules(rules.data ?? []), [rules.data]);

  if (rules.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (rules.isError) {
    return (
      <EmptyState
        icon={<Bell className="h-10 w-10" />}
        title="Couldn't load alert rules"
        description={(rules.error as Error).message}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Alert rules</h3>
        <p className="text-xs text-muted-foreground">
          Per-patient rules. Edits take effect within 30 s — the live engine reads rules per
          evaluation. Each card shows a 24 h dry-run preview so you can tune before saving.
        </p>
      </header>

      {/* Item 138: each section has id + aria-labelledby on the heading
          so screen readers announce the section name when tabbing into
          the first focusable child. */}
      <section className="space-y-3" aria-labelledby="rules-vitals-heading">
        <h4
          id="rules-vitals-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Vitals
        </h4>
        <VitalsRuleCard
          patientId={patientId}
          rule={grouped.vitals.hr_bpm ?? null}
          defaults={{ metric: 'hr_bpm', min: 50, max: 110 }}
          title="Heart rate"
        />
        <VitalsRuleCard
          patientId={patientId}
          rule={grouped.vitals.spo2_pct ?? null}
          defaults={{ metric: 'spo2_pct', min: 92, max: null }}
          title="SpO₂"
        />
        <VitalsRuleCard
          patientId={patientId}
          rule={grouped.vitals.temp_c ?? null}
          defaults={{ metric: 'temp_c', min: 35, max: 38 }}
          title="Temperature"
        />
      </section>

      <section className="space-y-3" aria-labelledby="rules-zone-heading">
        <h4
          id="rules-zone-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Zone (geofence)
        </h4>
        <ZoneRuleCard patientId={patientId} rule={grouped.zone} />
      </section>

      <section className="space-y-3" aria-labelledby="rules-fall-heading">
        <h4
          id="rules-fall-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Fall
        </h4>
        <FallRuleCard patientId={patientId} rule={grouped.fall} />
      </section>

      <section className="space-y-3" aria-labelledby="rules-inactivity-heading">
        <h4
          id="rules-inactivity-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Inactivity
        </h4>
        <InactivityRuleCard patientId={patientId} rule={grouped.inactivity} />
      </section>

      <section className="space-y-3" aria-labelledby="rules-device-silence-heading">
        <h4
          id="rules-device-silence-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Device silence
        </h4>
        <DeviceSilenceRuleCard patientId={patientId} rule={grouped.device_silence} />
      </section>
    </div>
  );
}

interface Grouped {
  vitals: Partial<Record<'hr_bpm' | 'spo2_pct' | 'temp_c', VitalsRule>>;
  zone: ZoneRule | null;
  fall: FallRule | null;
  inactivity: InactivityRule | null;
  device_silence: DeviceSilenceRule | null;
}

function groupRules(rules: AlertRule[]): Grouped {
  const grouped: Grouped = {
    vitals: {},
    zone: null,
    fall: null,
    inactivity: null,
    device_silence: null,
  };
  for (const r of rules) {
    if (r.type === 'vitals') {
      // First-write-wins per metric; the UI's V1 layout exposes one slot
      // per metric, so duplicates from manual edits are ignored.
      if (!grouped.vitals[r.params.metric]) {
        grouped.vitals[r.params.metric] = r;
      }
    } else if (r.type === 'zone' && grouped.zone == null) {
      grouped.zone = r;
    } else if (r.type === 'fall' && grouped.fall == null) {
      grouped.fall = r;
    } else if (r.type === 'inactivity' && grouped.inactivity == null) {
      grouped.inactivity = r;
    } else if (r.type === 'device_silence' && grouped.device_silence == null) {
      grouped.device_silence = r;
    }
  }
  return grouped;
}
