import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CONNECTOR_KIND_LABEL,
  ROOM_TYPE_LABEL,
  type ConnectorKind,
  type RoomConnectorRow,
  type RoomRow,
} from '@/features/floor-plan/roomTypes';

interface RoomsRailProps {
  rooms: RoomRow[];
  connectors: RoomConnectorRow[];
  /** radius_m per connector id, from the paired door_proximity alert_rule. */
  connectorRadiusM: Map<string, number>;
  roomsLoading: boolean;
  connectorsLoading: boolean;
  deleteRoomPending: boolean;
  deleteConnectorPending: boolean;
  errorMessage: string | null;
  onEditRoom: (row: RoomRow) => void;
  onDeleteRoom: (row: RoomRow) => void;
  onAddConnector: (kind: ConnectorKind) => void;
  onEditConnector: (row: RoomConnectorRow) => void;
  onDeleteConnector: (row: RoomConnectorRow) => void;
  /** Fires when the caregiver confirms a new buffer radius for a connector. */
  onUpdateRadius: (connectorId: string, radiusM: number) => void;
}

/** Inline buffer editor for a door/window connector.  Renders a small
 *  numeric input; on blur/Enter persists via onUpdateRadius. */
function BufferInput({
  connectorId,
  initialRadiusM,
  onUpdateRadius,
}: {
  connectorId: string;
  initialRadiusM: number;
  onUpdateRadius: (connectorId: string, radiusM: number) => void;
}) {
  const [draft, setDraft] = useState(String(initialRadiusM));

  function commit() {
    const v = Number(draft);
    if (Number.isFinite(v) && v > 0) {
      onUpdateRadius(connectorId, v);
    } else {
      // Revert draft to the last valid value.
      setDraft(String(initialRadiusM));
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={`buf-${connectorId}`} className="shrink-0 text-[10px] text-muted-foreground">
        Zone
      </Label>
      <Input
        id={`buf-${connectorId}`}
        type="number"
        min="0.1"
        step="0.1"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(String(initialRadiusM));
          }
        }}
        className="h-6 w-16 px-1.5 text-xs"
        aria-label="Proximity zone radius in metres"
      />
      <span className="shrink-0 text-[10px] text-muted-foreground">m</span>
    </div>
  );
}

/** Rooms section of the unified Place workspace rail. Rooms and
 *  doors/windows render live on the shared canvas overlay; this rail is
 *  their CRUD surface. Draw a polygon in the Floor plan section and use
 *  "Promote to room" for visual capture, or add coords here directly. */
export function RoomsRail({
  rooms,
  connectors,
  connectorRadiusM,
  roomsLoading,
  connectorsLoading,
  deleteRoomPending,
  deleteConnectorPending,
  errorMessage,
  onEditRoom,
  onDeleteRoom,
  onAddConnector,
  onEditConnector,
  onDeleteConnector,
  onUpdateRadius,
}: RoomsRailProps) {
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Rooms</CardTitle>
          <CardDescription>
            Named polygons. The rules engine uses them for entered/left alerts. To add one, select a
            closed shape (a room polygon or a ring of walls) on the floor plan and use{' '}
            <span className="font-medium text-foreground">Promote to room</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {roomsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rooms defined yet. Select a closed shape on the floor plan and use Promote to room
              to enable room-aware alerts.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rooms.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.polygon_canvas.length} vertices
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{ROOM_TYPE_LABEL[r.room_type]}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEditRoom(r)}
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDeleteRoom(r)}
                      disabled={deleteRoomPending}
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Doors, windows & openings</CardTitle>
            <CardDescription>
              Click Add door/window, then click two points on the floor plan to place the opening.
              Used for "approaching the door" and "left via" alerts.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAddConnector('door')}>
              <Plus className="h-4 w-4" />
              Add door
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAddConnector('window')}>
              <Plus className="h-4 w-4" />
              Add window
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {connectorsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No doors or windows yet. Add doors to enable door-proximity alerts.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {connectors.map((c) => {
                const roomALabel =
                  c.room_a_id != null ? (roomNameById.get(c.room_a_id) ?? '(deleted)') : '—';
                const roomBLabel =
                  c.room_b_id != null ? (roomNameById.get(c.room_b_id) ?? '(deleted)') : '—';
                const radiusM = connectorRadiusM.get(c.id);
                const hasPairedRule = radiusM != null && (c.kind === 'door' || c.kind === 'window');
                return (
                  <li key={c.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {c.label ?? CONNECTOR_KIND_LABEL[c.kind]}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          ({c.start_x.toFixed(0)}, {c.start_y.toFixed(0)}) → ({c.end_x.toFixed(0)},{' '}
                          {c.end_y.toFixed(0)}) · {roomALabel} ↔ {roomBLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{CONNECTOR_KIND_LABEL[c.kind]}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEditConnector(c)}
                          aria-label="Edit connector"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDeleteConnector(c)}
                          disabled={deleteConnectorPending}
                          aria-label="Delete connector"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {hasPairedRule && (
                      <BufferInput
                        key={`${c.id}-${radiusM}`}
                        connectorId={c.id}
                        initialRadiusM={radiusM!}
                        onUpdateRadius={onUpdateRadius}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {errorMessage && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
