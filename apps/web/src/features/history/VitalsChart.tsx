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
import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useVitalsHistory } from '@/lib/queries/history';
import { formatAppTz } from '@/lib/time';
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

// Item 101: tick + tooltip formatters render in AEST regardless of the
// presenter machine's local TZ — matches the badge claim in DateRangePicker.
function formatXTick(isoString: string, rangePreset: string): string {
  const ms = (RANGE_MS as Record<string, number>)[rangePreset] ?? RANGE_MS['7d'];
  if (ms <= RANGE_MS['24h']) {
    return formatAppTz(isoString, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return formatAppTz(isoString, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  const timeStr = formatAppTz(label as string, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

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

// Item 95: client-side decimator. At 24h × 1Hz × 3 series each <Line>
// renders a ~700KB SVG path; tooltip hit-test sweep + chart re-render
// blow the 200ms budget on the demo path 1h → 6h → 24h → 1h. Stride
// every Nth row preserving first + last when the dataset exceeds
// MAX_POINTS. Skip decimation for windows ≤ 1 h (≤3600 rows ≤ MAX_POINTS).
const MAX_POINTS = 1500;
function decimate<T extends { recorded_at: string }>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const stride = Math.max(1, Math.floor(rows.length / maxPoints));
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]!);
  // Always keep the last row so the chart's right edge matches the
  // window's `to`. Avoid a duplicate when stride lands cleanly on the
  // final index.
  const last = rows[rows.length - 1]!;
  if (out[out.length - 1]?.recorded_at !== last.recorded_at) out.push(last);
  return out;
}

export function VitalsChart({ patientId, range }: Props) {
  const { data, isLoading, isError, error } = useVitalsHistory(patientId, range);
  const decimated = useMemo(() => (data ? decimate(data, MAX_POINTS) : data), [data]);

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
      <LineChart data={decimated} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
