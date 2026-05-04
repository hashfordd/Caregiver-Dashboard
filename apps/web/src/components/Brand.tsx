import { cn } from '@/lib/utils';

interface BrandProps {
  size?: 'sm' | 'md' | 'lg';
  tagline?: boolean;
  className?: string;
}

const SIZES = {
  sm: 'text-2xl',
  md: 'text-4xl',
  lg: 'text-6xl',
} as const;

// Wordmark used at the top of unauthenticated surfaces (login / signup) and
// in the header of authed routes. Pairs the serif italic for the wordmark
// with the sans subtitle.
export function Brand({ size = 'md', tagline = false, className }: BrandProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <span
        className={cn(
          'font-serif italic font-semibold tracking-tight text-foreground',
          SIZES[size],
        )}
      >
        alzcare<span className="text-tangerine-500">.</span>
      </span>
      {tagline && (
        <span className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Caregiver dashboard
        </span>
      )}
    </div>
  );
}
