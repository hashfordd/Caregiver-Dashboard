import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertsTab } from '@/features/alerts/AlertsTab';
import { RuleSettingsTab } from '@/features/alerts/RuleSettingsTab';
import { Skeleton } from '@/components/ui/skeleton';
import { CaregiversTab } from './CaregiversTab';
import { PatientNotesSection } from './PatientNotesSection';
import { LiveTab } from './tabs/LiveTab';
import { PlaceTab } from './tabs/PlaceTab';

// F13: lazy-load HistoryTab so Recharts (~80 KB gzipped) and the
// Fabric replay glue aren't requested until the caregiver opens the
// History tab. See docs/features/F13.md → Risks → Recharts bundle weight.
const HistoryTab = lazy(() => import('@/features/history/HistoryTab'));

const TAB_KEYS = ['live', 'place', 'history', 'alerts', 'notes', 'caregivers', 'settings'] as const;
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
      {/* UI-29: at narrow widths the six triggers overflow the inline
          flex list. The wrapper makes the strip horizontally scrollable
          on touch — see /touch-pan-x — without affecting desktop layout. */}
      <div className="-mx-2 overflow-x-auto px-2 sm:mx-0 sm:px-0">
        <TabsList className="min-w-max">
        <TabsTrigger value="live">Live</TabsTrigger>
        <TabsTrigger value="place">Place</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="alerts">Alerts</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="caregivers">Caregivers</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="live">
        <LiveTab />
      </TabsContent>
      <TabsContent value="place">
        <PlaceTab />
      </TabsContent>
      <TabsContent value="history">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <HistoryTab patientId={patientId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="alerts">
        <AlertsTab patientId={patientId} />
      </TabsContent>
      <TabsContent value="notes">
        <PatientNotesSection patientId={patientId} />
      </TabsContent>
      <TabsContent value="caregivers">
        <CaregiversTab patientId={patientId} />
      </TabsContent>
      <TabsContent value="settings">
        <RuleSettingsTab patientId={patientId} />
      </TabsContent>
    </Tabs>
  );
}
