import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  roomsLoading: boolean;
  connectorsLoading: boolean;
  deleteRoomPending: boolean;
  deleteConnectorPending: boolean;
  errorMessage: string | null;
  onAddRoom: () => void;
  onEditRoom: (row: RoomRow) => void;
  onDeleteRoom: (row: RoomRow) => void;
  onAddConnector: (kind: ConnectorKind) => void;
  onEditConnector: (row: RoomConnectorRow) => void;
  onDeleteConnector: (row: RoomConnectorRow) => void;
}

/** Rooms section of the unified Place workspace rail. Rooms and
 *  doors/windows render live on the shared canvas overlay; this rail is
 *  their CRUD surface. Draw a polygon in the Floor plan section and use
 *  "Promote to room" for visual capture, or add coords here directly. */
export function RoomsRail({
  rooms,
  connectors,
  roomsLoading,
  connectorsLoading,
  deleteRoomPending,
  deleteConnectorPending,
  errorMessage,
  onAddRoom,
  onEditRoom,
  onDeleteRoom,
  onAddConnector,
  onEditConnector,
  onDeleteConnector,
}: RoomsRailProps) {
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Rooms</CardTitle>
            <CardDescription>
              Named polygons. The rules engine uses them for entered/left alerts.
            </CardDescription>
          </div>
          <Button size="sm" onClick={onAddRoom}>
            <Plus className="h-4 w-4" />
            Add room
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {roomsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rooms defined yet. Add one to enable room-aware alerts.
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
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
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
