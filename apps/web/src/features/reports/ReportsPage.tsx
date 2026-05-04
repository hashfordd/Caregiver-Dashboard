import { LineChart } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// Phase 5 / F13 — history scrubber, vitals charts, alert history filters,
// CSV export. Reserved here so the navbar link has a destination.
export function ReportsPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Long-range view</p>
        <h1 className="font-serif italic text-4xl text-foreground">Reports</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Replay movement, scrub vitals across a date range, filter alert history, and export to CSV
          for handover or clinical review.
        </p>
      </header>
      <EmptyState
        icon={<LineChart className="h-10 w-10" />}
        title="Coming in Phase 5"
        description="History scrubber, vitals charts, alert history filters, and CSV export (F13) land in Phase 5."
      />
    </main>
  );
}
