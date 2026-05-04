import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LiveTab } from './tabs/LiveTab';
import { PlaceholderTab } from './tabs/PlaceholderTab';

const TAB_KEYS = ['live', 'place', 'history', 'alerts', 'settings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

export function PatientTabs() {
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
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="live">
        <LiveTab />
      </TabsContent>
      <TabsContent value="place">
        <PlaceholderTab phase={2} feature="Floor plan editor, beacon pairing, calibration walk." />
      </TabsContent>
      <TabsContent value="history">
        <PlaceholderTab phase={5} feature="Movement replay, vitals charts, CSV export." />
      </TabsContent>
      <TabsContent value="alerts">
        <PlaceholderTab phase={4} feature="Alert feed and acknowledgement workflow." />
      </TabsContent>
      <TabsContent value="settings">
        <PlaceholderTab phase={4} feature="Per-patient alert rule configuration." />
      </TabsContent>
    </Tabs>
  );
}
