import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertsTab } from '@/features/alerts/AlertsTab';
import { RuleSettingsTab } from '@/features/alerts/RuleSettingsTab';
import { PatientNotesSection } from './PatientNotesSection';
import { LiveTab } from './tabs/LiveTab';
import { PlaceTab } from './tabs/PlaceTab';
import { PlaceholderTab } from './tabs/PlaceholderTab';

const TAB_KEYS = ['live', 'place', 'history', 'alerts', 'notes', 'settings'] as const;
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
      <TabsList>
        <TabsTrigger value="live">Live</TabsTrigger>
        <TabsTrigger value="place">Place</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="alerts">Alerts</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="live">
        <LiveTab />
      </TabsContent>
      <TabsContent value="place">
        <PlaceTab />
      </TabsContent>
      <TabsContent value="history">
        <PlaceholderTab phase={5} feature="Movement replay, vitals charts, CSV export." />
      </TabsContent>
      <TabsContent value="alerts">
        <AlertsTab patientId={patientId} />
      </TabsContent>
      <TabsContent value="notes">
        <PatientNotesSection patientId={patientId} />
      </TabsContent>
      <TabsContent value="settings">
        <RuleSettingsTab patientId={patientId} />
      </TabsContent>
    </Tabs>
  );
}
