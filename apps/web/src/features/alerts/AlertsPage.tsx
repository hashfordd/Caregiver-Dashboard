import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Phase 4 lands the global alert feed (F11 + F12). For Phase 1, alerts live
// inside each patient's detail view; this page is reserved as the
// destination for the navbar link.
export function AlertsPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notifications</p>
        <h1 className="font-serif italic text-4xl text-foreground">Alerts</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          One feed of every alert firing across the patients you're allocated to. Per-patient alert
          rules live inside the patient detail view's <em>Settings</em> tab.
        </p>
      </header>
      <EmptyState
        icon={<Bell className="h-10 w-10" />}
        title="Coming in Phase 4"
        description="The cross-patient alert feed (F12) and the rules-engine evaluator (F11) land in Phase 4. Until then, watch alerts inside a patient's detail view."
      />
    </main>
  );
}
