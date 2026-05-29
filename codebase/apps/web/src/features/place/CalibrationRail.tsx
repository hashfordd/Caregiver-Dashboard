import { MapPin, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CaptureCoordinator } from '@/features/calibration/CaptureCoordinator';
import type { CalibrationPointRow } from '@/features/calibration/types';

const MIN_PLACED_FOR_F8 = 8;

interface CalibrationRailProps {
  floorPlanId: string | null;
  placementReady: boolean;
  planExists: boolean;
  points: CalibrationPointRow[];
  pending: { x: number; y: number } | null;
  deletingId: string | undefined;
  deleteError: string | null;
  onCaptureSuccess: () => void;
  onCaptureCancel: () => void;
  onDeletePoint: (id: string) => void;
}

/** Calibration section of the unified Place workspace rail. Clicking the
 *  shared canvas marks the pending spot; this rail drives the capture
 *  timer and lists the captured fingerprints. */
export function CalibrationRail({
  floorPlanId,
  placementReady,
  planExists,
  points,
  pending,
  deletingId,
  deleteError,
  onCaptureSuccess,
  onCaptureCancel,
  onDeletePoint,
}: CalibrationRailProps) {
  if (!placementReady || floorPlanId == null) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {planExists
            ? 'Switch to the Floor plan section, select a wall and use Set scale before capturing fingerprints.'
            : 'Switch to the Floor plan section and draw the patient’s space first.'}
        </span>
      </div>
    );
  }

  const placedCount = points.length;
  const showFewerNotice = placedCount < MIN_PLACED_FOR_F8;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeader
          title="Calibration"
          subtitle="Stand the wearable at a known spot, click that point on the floor plan, then press Capture. F8 needs at least 8 captures spread across the rooms."
        />
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex-1">
                <CaptureCoordinator
                  floorPlanId={floorPlanId}
                  pending={pending}
                  onSuccess={onCaptureSuccess}
                  onCancel={onCaptureCancel}
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
              ? 'No captures yet — click the floor plan and press Capture.'
              : `${placedCount} captured`
          }
        />
        {placedCount > 0 && (
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
                    onClick={() => onDeletePoint(p.id)}
                    disabled={deletingId === p.id}
                  >
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
            {deleteError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Couldn't delete: {deleteError}
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
