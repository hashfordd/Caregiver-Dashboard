import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface SparklineProps {
  points: { t: number; v: number }[];
  width?: number;
  height?: number;
  className?: string;
}

// Pure-SVG sparkline. Recharts is deferred to F13 where the history charts
// genuinely need axes and tooltips; here we just need a quick trend line.
export function Sparkline({ points, width = 200, height = 40, className }: SparklineProps) {
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const ts = points.map((p) => p.t);
    const vs = points.map((p) => p.v);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(...vs);
    const vMax = Math.max(...vs);
    const tSpan = tMax - tMin || 1;
    const vSpan = vMax - vMin || 1;
    return points
      .map((p, i) => {
        const x = ((p.t - tMin) / tSpan) * width;
        const y = height - ((p.v - vMin) / vSpan) * height;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, width, height]);

  return (
    <svg
      className={cn('text-primary', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
