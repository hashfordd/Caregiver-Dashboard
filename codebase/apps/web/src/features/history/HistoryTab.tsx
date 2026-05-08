import { useMemo, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { computeRange, type DateRange } from './types';
import { DateRangePicker } from './DateRangePicker';
import { ReplayScrubber } from './ReplayScrubber';
import { VitalsChart } from './VitalsChart';
import { AlertHistoryFilter } from './AlertHistoryFilter';
import { CsvExport } from './CsvExport';

const SUB_TABS = ['replay', 'vitals', 'alerts', 'export'] as const;
type SubTab = (typeof SUB_TABS)[number];

function isSubTab(value: string): value is SubTab {
  return (SUB_TABS as readonly string[]).includes(value);
}

interface Props {
  patientId: string;
}

/** F13 history tab. Owns the date-range picker shared across the four
 *  sub-surfaces (replay, vitals, alerts, export) and pushes the
 *  selection into local state. Sub-tab state is stored in component
 *  state (not the URL) — the patient detail's `?tab=history` already
 *  identifies the surface and an extra `?subtab=` query param would
 *  bloat shareable URLs without a strong use case.
 *
 *  Lazy-loaded from PatientTabs so Recharts (~80 KB gzipped) and the
 *  Fabric replay glue aren't requested until the caregiver opens the
 *  tab. See F13.md → Risks → Recharts bundle weight. */
export function HistoryTab({ patientId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('replay');
  const [range, setRange] = useState<DateRange>(() => {
    const { from, to } = computeRange('1h', Date.now());
    return { preset: '1h', from, to };
  });

  const planQuery = useFloorPlan(patientId);

  // Replay only makes sense if there's a saved floor plan to render
  // against. The other three sub-tabs work regardless. The empty state
  // shape mirrors LivePositionView so the caregiver sees the same
  // "set up the floor plan" affordance they'd see live.
  const replayContent = useMemo(() => {
    if (planQuery.isLoading) {
      return <Skeleton className="h-[480px] w-full" />;
    }
    if (!planQuery.data) {
      return (
        <EmptyState
          icon={<HistoryIcon className="h-10 w-10" />}
          title="No floor plan yet"
          description="Movement replay needs a saved floor plan to render against."
          action={
            <Link
              to={`/patients/${patientId}?tab=place`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Set up a floor plan first →
            </Link>
          }
        />
      );
    }
    return (
      <ReplayScrubber
        patientId={patientId}
        range={range}
        canvasJson={planQuery.data.canvas_json}
        scaleMetersPerPixel={planQuery.data.scale_meters_per_pixel}
      />
    );
  }, [patientId, range, planQuery.data, planQuery.isLoading]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">History</h3>
          <p className="text-xs text-muted-foreground">
            Replay movement, scrub vitals, filter alerts, and export to CSV.
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      <Tabs value={subTab} onValueChange={(v) => isSubTab(v) && setSubTab(v)}>
        <TabsList>
          <TabsTrigger value="replay">Replay</TabsTrigger>
          <TabsTrigger value="vitals">Vitals</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        <TabsContent value="replay">{replayContent}</TabsContent>
        <TabsContent value="vitals">
          <VitalsChart patientId={patientId} range={range} />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertHistoryFilter patientId={patientId} range={range} />
        </TabsContent>
        <TabsContent value="export">
          <CsvExport patientId={patientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Default export so the lazy() in PatientTabs.tsx can match React's
// expected `default` shape without an extra `.then(m => ({...}))`.
export default HistoryTab;
