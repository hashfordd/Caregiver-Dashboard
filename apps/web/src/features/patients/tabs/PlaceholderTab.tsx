import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

// One reusable placeholder for tabs whose owning feature has not yet shipped.
export function PlaceholderTab({ phase, feature }: { phase: number; feature: string }) {
  return (
    <EmptyState
      icon={<Sparkles className="h-10 w-10" />}
      title={`Coming in Phase ${phase}`}
      description={feature}
    />
  );
}
