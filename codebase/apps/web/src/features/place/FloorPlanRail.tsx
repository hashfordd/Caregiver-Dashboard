import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';

interface FloorPlanRailProps {
  editing: boolean;
  scaleLabel: string;
  savedTone: string | null;
  remoteVersionPending: boolean;
  onAcceptRemote: () => void;
  upsertError: string | null;
  pathLossExponentDraft: string;
  pathLossExponentInputValid: boolean;
  onPathLossInput: (e: ChangeEvent<HTMLInputElement>) => void;
}

/** Floor-plan section of the unified Place workspace rail. The drawing
 *  toolbar lives above the canvas (full width); this rail carries the
 *  read-outs and the install-time path-loss override that don't belong
 *  on the action bar. */
export function FloorPlanRail({
  editing,
  scaleLabel,
  savedTone,
  remoteVersionPending,
  onAcceptRemote,
  upsertError,
  pathLossExponentDraft,
  pathLossExponentInputValid,
  onPathLossInput,
}: FloorPlanRailProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Floor plan</h3>
        <p className="text-xs text-muted-foreground">
          Draw walls, rooms and furniture, then anchor pixels to metres so positioning has a
          real-world scale.
        </p>
      </div>

      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        <span className="font-medium text-foreground/80">Scale: </span>
        <span className="text-muted-foreground">{scaleLabel}</span>
      </div>

      {savedTone && (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-xs text-foreground/80">{savedTone}</p>
      )}

      {remoteVersionPending && (
        <div className="space-y-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span>Another caregiver saved a newer version of this floor plan.</span>
          <Button size="sm" variant="outline" onClick={onAcceptRemote}>
            Reload (lose unsaved)
          </Button>
        </div>
      )}

      {upsertError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {upsertError}
        </p>
      )}

      {/* Path-loss exponent override. Set once at install per room/material —
          free-space ~ 2.0, drywall ~ 3.0, concrete ~ 4.0. Leave blank to use
          the code default (2.0). Read-only outside Edit mode so a caregiver
          can't bump it accidentally. */}
      <div className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="path-loss-exponent" className="font-medium text-foreground/80">
            Path-loss exponent (n)
          </label>
          <input
            id="path-loss-exponent"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={1.0}
            max={6.0}
            placeholder="2.0"
            value={pathLossExponentDraft}
            onChange={onPathLossInput}
            disabled={!editing}
            aria-invalid={!pathLossExponentInputValid}
            className="h-7 w-20 rounded border border-input bg-background px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive"
          />
        </div>
        <p className="text-muted-foreground">
          Free-space ≈ 2.0 · drywall ≈ 3.0 · concrete ≈ 4.0 · blank = default 2.0
        </p>
        {!pathLossExponentInputValid && <p className="text-destructive">Must be 1.0–6.0</p>}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Walls: click to start, click again to finish (snaps to nearby joins). Cmd/Ctrl+Z undo ·
        Shift for ortho · Space + drag to pan · scroll to zoom · Enter to finish a polygon · Esc to
        cancel.
      </p>
    </div>
  );
}
