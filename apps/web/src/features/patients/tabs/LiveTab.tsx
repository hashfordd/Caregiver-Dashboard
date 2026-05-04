import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// F3 ships this as a placeholder. F4 fills it with the live sensor cards
// (HR / SpO2 / temperature / motion + sparklines + stale-data indicator).
// F10 adds the device pairing CTA when a patient has no paired device.
export function LiveTab() {
  return (
    <EmptyState
      icon={<Activity className="h-10 w-10" />}
      title="No live data yet"
      description="Pair a device to start streaming this patient's vitals."
    />
  );
}
