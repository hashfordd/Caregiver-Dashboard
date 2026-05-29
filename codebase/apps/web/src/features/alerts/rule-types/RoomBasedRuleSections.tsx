import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DoorProximityRule, RoomTransitionRule } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useRoomConnectors, useRooms } from '@/features/floor-plan/roomQueries';
import { CONNECTOR_KIND_LABEL } from '@/features/floor-plan/roomTypes';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { DoorProximityRuleDialog } from './DoorProximityRuleDialog';
import { RoomTransitionRuleDialog } from './RoomTransitionRuleDialog';

interface Props {
  patientId: string;
  roomTransitionRules: RoomTransitionRule[];
  doorProximityRules: DoorProximityRule[];
}

/** Phase C: list-based UI for the two new multi-instance rule types.
 *  Each section shows existing rules with edit/delete affordances + a
 *  "+ Add rule" button that opens the shared dialog. Lookups for the
 *  referenced room / connector are local so deleted entities surface
 *  as "(deleted)" instead of empty space. */
export function RoomBasedRuleSections({
  patientId,
  roomTransitionRules,
  doorProximityRules,
}: Props) {
  const planQuery = useFloorPlan(patientId);
  const roomsQuery = useRooms(planQuery.data?.id);
  const connectorsQuery = useRoomConnectors(planQuery.data?.id);
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);

  const [transitionDialogOpen, setTransitionDialogOpen] = useState(false);
  const [transitionEditTarget, setTransitionEditTarget] = useState<RoomTransitionRule | null>(null);
  const [proximityDialogOpen, setProximityDialogOpen] = useState(false);
  const [proximityEditTarget, setProximityEditTarget] = useState<DoorProximityRule | null>(null);

  const rooms = roomsQuery.data ?? [];
  const connectors = connectorsQuery.data ?? [];
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));
  const connectorLabelById = new Map(
    connectors.map((c) => [c.id, c.label ?? CONNECTOR_KIND_LABEL[c.kind]]),
  );

  function openAddTransition() {
    setTransitionEditTarget(null);
    setTransitionDialogOpen(true);
  }
  function openEditTransition(rule: RoomTransitionRule) {
    setTransitionEditTarget(rule);
    setTransitionDialogOpen(true);
  }
  function openAddProximity() {
    setProximityEditTarget(null);
    setProximityDialogOpen(true);
  }
  function openEditProximity(rule: DoorProximityRule) {
    setProximityEditTarget(rule);
    setProximityDialogOpen(true);
  }

  return (
    <>
      <section className="space-y-3" aria-labelledby="rules-room-transition-heading">
        <div className="flex items-center justify-between">
          <h4
            id="rules-room-transition-heading"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Room presence
          </h4>
          <Button size="sm" variant="outline" onClick={openAddTransition}>
            <Plus className="h-4 w-4" />
            Add rule
          </Button>
        </div>
        {roomsQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : roomTransitionRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No room presence rules yet. Add one to alert when a patient enters or leaves a specific
            room.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {roomTransitionRules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <RuleSummary
                  primary={`${rule.params.direction === 'enter' ? 'Entered' : 'Left'} ${
                    roomNameById.get(rule.params.room_id) ?? '(deleted room)'
                  }`}
                  secondary={`dwell ${rule.params.dwell_seconds}s · severity ${rule.severity}${
                    rule.enabled ? '' : ' · disabled'
                  }`}
                />
                <RuleRowActions
                  onEdit={() => openEditTransition(rule)}
                  onDelete={() => remove.mutate(rule.id)}
                  disabled={remove.isPending}
                  label="room transition"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="rules-door-proximity-heading">
        <div className="flex items-center justify-between">
          <h4
            id="rules-door-proximity-heading"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Door proximity
          </h4>
          <Button size="sm" variant="outline" onClick={openAddProximity}>
            <Plus className="h-4 w-4" />
            Add rule
          </Button>
        </div>
        {connectorsQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : doorProximityRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No door proximity rules yet. Add one to alert when a patient is within a given radius of
            a specific door or window.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {doorProximityRules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <RuleSummary
                  primary={`Near ${connectorLabelById.get(rule.params.connector_id) ?? '(deleted)'}`}
                  secondary={`within ${rule.params.radius_m} m for ${rule.params.dwell_seconds}s · severity ${rule.severity}${
                    rule.enabled ? '' : ' · disabled'
                  }`}
                />
                <RuleRowActions
                  onEdit={() => openEditProximity(rule)}
                  onDelete={() => remove.mutate(rule.id)}
                  disabled={remove.isPending}
                  label="door proximity"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RoomTransitionRuleDialog
        open={transitionDialogOpen}
        onOpenChange={setTransitionDialogOpen}
        patientId={patientId}
        rooms={rooms}
        initial={transitionEditTarget}
        submitting={upsert.isPending}
        onConfirm={async (input) => {
          await upsert.mutateAsync(input);
        }}
      />
      <DoorProximityRuleDialog
        open={proximityDialogOpen}
        onOpenChange={setProximityDialogOpen}
        patientId={patientId}
        connectors={connectors}
        initial={proximityEditTarget}
        submitting={upsert.isPending}
        onConfirm={async (input) => {
          await upsert.mutateAsync(input);
        }}
      />
    </>
  );
}

function RuleSummary({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-sm font-medium text-foreground">{primary}</span>
      <span className="text-[10px] text-muted-foreground">{secondary}</span>
    </div>
  );
}

function RuleRowActions({
  onEdit,
  onDelete,
  disabled,
  label,
}: {
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${label} rule`}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`Delete ${label} rule`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
