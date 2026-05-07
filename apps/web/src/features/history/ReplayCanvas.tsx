import { forwardRef, useImperativeHandle, useRef } from 'react';
import { FloorPlanCanvas } from '@/features/floor-plan/FloorPlanCanvas';
import type { FloorPlanCanvasHandle, ReplayDotSprite } from '@/features/floor-plan/types';

interface ReplayCanvasProps {
  canvasJson: unknown;
  scaleMetersPerPixel: number | null;
  className?: string;
}

/** The canvas surface used by ReplayScrubber. Wraps FloorPlanCanvas in
 *  read-only calibration mode (no editing, no beacons, no marker) and
 *  exposes only the replay-specific surface to the scrubber. */
export interface ReplayCanvasHandle {
  setReplayDots: (sprites: ReplayDotSprite[]) => void;
}

export const ReplayCanvas = forwardRef<ReplayCanvasHandle, ReplayCanvasProps>(function ReplayCanvas(
  { canvasJson, scaleMetersPerPixel, className },
  ref,
) {
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setReplayDots: (sprites) => {
        canvasRef.current?.setReplayDots(sprites);
      },
    }),
    [],
  );

  return (
    <FloorPlanCanvas
      ref={canvasRef}
      initialJson={canvasJson}
      scale={scaleMetersPerPixel}
      editing={false}
      initialMode="calibration"
      showDimensions={false}
      className={className}
      ariaLabel="Movement replay canvas — patient indoor position over the selected time window"
    />
  );
});
