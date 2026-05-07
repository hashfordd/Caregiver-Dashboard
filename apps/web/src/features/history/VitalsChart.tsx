import { Activity } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useVitalsHistory } from '@/lib/queries/history';
import type { DateRange } from './types';

// Dual-axis approach: HR on the left axis (physiological range 40–180 bpm),
// SpO2 and temp on the right axis. SpO2 is 85–100 % and temp is 35–40 °C —
// both fit the same right-axis domain (35–100) without needing normalisation,
// and the different scales are clear from the legend labels. Three-chart
// stacking was considered but wastes vertical space for a single patient view.
//
// Temperature unit: V1 renders °C only. The F1 caregiver °C/°F preference
// toggle was deferred (see BACKLOG.md). Lift this to the shared formatter in
// apps/web/src/lib/units/temperature.ts when that toggle ships.

interface Props {
  patientId: string;
  range: DateRange;
}

const HOUR_MS = 60 * 60 * 1000;
const RANGE_MS = {
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * 24 * HOUR_MS,
} as const;

function formatXTick(isoString: string, rangePreset: string): string {
  const date = new Date(isoString);
  const ms = (RANGE_MS as Record<string, number>)[rangePreset] ?? RANGE_MS['7d'];
  if (ms <= RANGE_MS['24h']) {
    // HH:mm for 1h/6h/24h
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
  // MMM d HH:mm for 7d / custom
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const date = new Date(label as string);
  const timeStr = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-foreground">{timeStr}</p>
      {payload.map((entry) => {
        if (entry.value == null) return null;
        let formatted: string;
        if (entry.dataKey === 'temp_c') {
          formatted = `${(entry.value as number).toFixed(1)} °C`;
        } else if (entry.dataKey === 'spo2_pct') {
          formatted = `${Math.round(entry.value as number)} %`;
        } else {
          formatted = `${Math.round(entry.value as number)} bpm`;
        }
        return (
          <p key={entry.dataKey} style={{ color: entry.color }}>
            {entry.name}: {formatted}
          </p>
        );
      })}
    </div>
  );
}

export function VitalsChart({ patientId, range }: Props) {
  const { data, isLoading, isError, error } = useVitalsHistory(patientId, range);

  if (isLoading) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (isError) {
    const msg =
      import.meta.env.DEV && error instanceof Error
        ? error.message
        : 'Could not load vitals history.';
    return (
      <EmptyState
        icon={<Activity className="h-10 w-10" />}
        title="Failed to load vitals"
        description={msg}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-10 w-10" />}
        title="No vitals in this range"
        description="Try a wider time window or check that the device is transmitting."
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="recorded_at"
          tickFormatter={(v) => formatXTick(v as string, range.preset)}
          tick={{ fontSize: 11 }}
          minTickGap={40}
          className="text-muted-foreground"
        />
        {/* Left axis: HR (bpm), domain covers clinical range */}
        <YAxis
          yAxisId="hr"
          orientation="left"
          domain={[40, 180]}
          tickCount={6}
          tick={{ fontSize: 11 }}
          label={{
            value: 'bpm',
            angle: -90,
            position: 'insideLeft',
            offset: 8,
            style: { fontSize: 11 },
          }}
          className="text-muted-foreground"
        />
        {/* Right axis: SpO2 (%) and temp (°C) share a 35–100 domain.
            SpO2 is 85–100 % and temp is 35–40 °C — both land near the
            top of this axis, which makes their relative movement readable
            side-by-side without normalisation. */}
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[35, 100]}
          tickCount={6}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => {
            if (value === 'hr_bpm') return 'HR (bpm)';
            if (value === 'spo2_pct') return 'SpO₂ (%)';
            if (value === 'temp_c') return 'Temp (°C)';
            return value;
          }}
        />
        <Line
          yAxisId="hr"
          type="monotone"
          dataKey="hr_bpm"
          name="hr_bpm"
          stroke="hsl(var(--chart-1, 220 70% 55%))"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="spo2_pct"
          name="spo2_pct"
          stroke="hsl(var(--chart-2, 160 60% 45%))"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="temp_c"
          name="temp_c"
          stroke="hsl(var(--chart-3, 30 80% 55%))"
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
