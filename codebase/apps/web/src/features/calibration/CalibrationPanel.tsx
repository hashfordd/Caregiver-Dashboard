import { useRef, useState } from 'react';
import { MapPin, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useBeacons } from '@/features/beacons/beaconQueries';
import { useCalibrationPoints, useDeleteCalibrationPoint } from './calibrationQueries';
import { CalibrationCanvas, type CalibrationCanvasHandle } from './CalibrationCanvas';
import { CaptureCoordinator } from './CaptureCoordinator';

const MIN_PLACED_FOR_F8 = 8;

interface CalibrationPanelProps {
  patientId: string;
}

export function CalibrationPanel({ patientId }: CalibrationPanelProps) {
  const planQuery = useFloorPlan(patientId);
  const beaconsQuery = useBeacons(patientId);
  const plan = planQuery.data ?? null;
  const placementReady = plan != null && plan.scale_meters_per_pixel != null;

  const pointsQuery = useCalibrationPoints(plan?.id);
  const deletePoint = useDeleteCalibrationPoint(plan?.id ?? '');

  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<CalibrationCanvasHandle | null>(null);

  if (planQuery.isLoading || beaconsQuery.isLoading || pointsQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
      </div>
    );
  }

  if (pointsQuery.isError) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">
            Couldn't load calibration points: {(pointsQuery.error as Error).message}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => pointsQuery.refetch()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!placementReady) {
    return (
      <EmptyState
        icon={<MapPin className="h-10 w-10" />}
        title={plan == null ? 'No floor plan yet' : 'Floor plan needs a scale'}
        description={
          plan == null
            ? 'Open the Floor plan sub-tab and draw the patient’s space first.'
            : 'In the Floor plan sub-tab, select a wall and use Set scale before capturing fingerprints.'
        }
      />
    );
  }

  const points = pointsQuery.data ?? [];
  const beacons = beaconsQuery.data ?? [];
  const placedCount = points.length;
  const showFewerNotice = placedCount < MIN_PLACED_FOR_F8;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeader
          title="Calibration"
          subtitle="Stand the wearable at a known spot, click that point on the floor plan, then press Capture. F8 indoor positioning needs at least 8 captures spread across the rooms."
        />
        <div className="h-[min(60vh,720px)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border bg-card">
          <CalibrationCanvas
            ref={canvasRef}
            floorPlan={plan}
            beacons={beacons}
            points={points}
            pending={pending}
            onCalibrationClick={(x, y) => setPending({ x, y })}
          />
        </div>

        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex-1">
                <CaptureCoordinator
                  floorPlanId={plan.id}
                  pending={pending}
                  onSuccess={() => setPending(null)}
                  onCancel={() => setPending(null)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {showFewerNotice && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {placedCount === 0
              ? `0 of ${MIN_PLACED_FOR_F8} captures. F8 indoor positioning needs at least ${MIN_PLACED_FOR_F8} spread across the rooms.`
              : `${placedCount} of ${MIN_PLACED_FOR_F8} captures. ${MIN_PLACED_FOR_F8 - placedCount} more before F8 has the corpus it needs.`}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeader
          title="Captured points"
          subtitle={
            placedCount === 0
              ? 'No captures yet — click the floor plan above and press Capture.'
              : `${placedCount} captured`
          }
        />
        {placedCount === 0 ? null : (
          <div className="space-y-2">
            {points.map((p, i) => (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-600 dark:text-sky-300">
                        {i + 1}
                      </span>
                      <span className="font-mono">
                        ({p.x_canvas}, {p.y_canvas})
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.ble_signature.samples.length} BLE · {p.wifi_signature.samples.length} WiFi
                      · captured {new Date(p.captured_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePoint.mutate(p.id)}
                    disabled={deletePoint.isPending && deletePoint.variables === p.id}
                  >
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
            {deletePoint.isError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Couldn't delete: {(deletePoint.error as Error).message}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle: string;
}

function SectionHeader({ title, subtitle }: SectionHeaderProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
