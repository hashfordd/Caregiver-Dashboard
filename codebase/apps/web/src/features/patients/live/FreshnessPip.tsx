import { cn } from '@/lib/utils';

/** Live/stale status pip shared by the sensor, movement, and activity cards.
 *  No data → a dim grey dot; fresh → an accent dot with a ping halo; stale →
 *  a solid destructive dot. */
export function FreshnessPip({ stale, hasData }: { stale: boolean; hasData: boolean }) {
  if (!hasData) {
    return (
      <span className="h-2 w-2 rounded-full bg-muted-foreground/30" aria-label="no data yet" />
    );
  }
  return (
    <span className="relative flex h-2 w-2" aria-label={stale ? 'stale' : 'fresh'}>
      {!stale && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
      )}
      <span
        className={cn(
          'relative inline-flex h-2 w-2 rounded-full',
          stale ? 'bg-destructive' : 'bg-accent',
        )}
      />
    </span>
  );
}
