import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertsTab } from '@/features/alerts/AlertsTab';
import { RuleSettingsTab } from '@/features/alerts/RuleSettingsTab';
import { Skeleton } from '@/components/ui/skeleton';
import { TabErrorBoundary } from '@/components/RootErrorBoundary';
import { CaregiversTab } from './CaregiversTab';
import { PatientNotesSection } from './PatientNotesSection';
import { CarePlanTab } from './tabs/CarePlanTab';
import { IncidentsTab } from './tabs/IncidentsTab';
import { LiveTab } from './tabs/LiveTab';
import { MedsTab } from './tabs/MedsTab';
import { PlaceTab } from './tabs/PlaceTab';

// F13: lazy-load HistoryTab so Recharts (~80 KB gzipped) and the
// Fabric replay glue aren't requested until the caregiver opens the
// History tab. See docs/features/F13.md → Risks → Recharts bundle weight.
const HistoryTab = lazy(() => import('@/features/history/HistoryTab'));

const TAB_KEYS = [
  'live',
  'place',
  'history',
  'alerts',
  'care-plan',
  'incidents',
  'meds',
  'notes',
  'caregivers',
  'settings',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

interface Props {
  patientId: string;
}

export function PatientTabs({ patientId }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') ?? 'live';
  const value: TabKey = isTabKey(tabParam) ? tabParam : 'live';

  function setValue(next: string) {
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('tab', next);
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <Tabs value={value} onValueChange={setValue}>
      {/* UI-29: at narrow widths the seven triggers overflow the inline
          flex list. The wrapper makes the strip horizontally scrollable
          on touch — see /touch-pan-x — without affecting desktop layout.
          Item 119: a right-edge mask + scroll-snap surface a "more tabs
          past the right" affordance so caregivers don't miss Settings
          on narrow viewports. */}
      <div className="-mx-2 overflow-x-auto px-2 sm:mx-0 sm:px-0 [scroll-snap-type:x_mandatory] sm:[scroll-snap-type:none] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]">
        <TabsList className="min-w-max">
          <TabsTrigger value="live" className="[scroll-snap-align:start]">
            Live
          </TabsTrigger>
          <TabsTrigger value="place" className="[scroll-snap-align:start]">
            Place
          </TabsTrigger>
          <TabsTrigger value="history" className="[scroll-snap-align:start]">
            History
          </TabsTrigger>
          <TabsTrigger value="alerts" className="[scroll-snap-align:start]">
            Alerts
          </TabsTrigger>
          <TabsTrigger value="care-plan" className="[scroll-snap-align:start]">
            Care plan
          </TabsTrigger>
          <TabsTrigger value="incidents" className="[scroll-snap-align:start]">
            Incidents
          </TabsTrigger>
          <TabsTrigger value="meds" className="[scroll-snap-align:start]">
            Meds
          </TabsTrigger>
          <TabsTrigger value="notes" className="[scroll-snap-align:start]">
            Notes
          </TabsTrigger>
          <TabsTrigger value="caregivers" className="[scroll-snap-align:start]">
            Caregivers
          </TabsTrigger>
          <TabsTrigger value="settings" className="[scroll-snap-align:start]">
            Settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="live">
        <TabErrorBoundary label="Live">
          <LiveTab />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="place">
        <TabErrorBoundary label="Place">
          <PlaceTab />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="history">
        <TabErrorBoundary label="History">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <HistoryTab patientId={patientId} />
          </Suspense>
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="alerts">
        <TabErrorBoundary label="Alerts">
          <AlertsTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="care-plan">
        <TabErrorBoundary label="Care plan">
          <CarePlanTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="incidents">
        <TabErrorBoundary label="Incidents">
          <IncidentsTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="meds">
        <TabErrorBoundary label="Meds">
          <MedsTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="notes">
        <TabErrorBoundary label="Notes">
          <PatientNotesSection patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="caregivers">
        <TabErrorBoundary label="Caregivers">
          <CaregiversTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
      <TabsContent value="settings">
        <TabErrorBoundary label="Settings">
          <RuleSettingsTab patientId={patientId} />
        </TabErrorBoundary>
      </TabsContent>
    </Tabs>
  );
}
