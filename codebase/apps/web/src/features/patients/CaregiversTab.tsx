import { useState } from 'react';
import { Plus, Shield, Trash, User as UserIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useAllocatePatient,
  useCurrentCaregiver,
  usePatientCaregivers,
  useUnallocatePatient,
  useUnallocatedMembers,
} from '@/features/provider/providerQueries';

interface Props {
  patientId: string;
}

export function CaregiversTab({ patientId }: Props) {
  const me = useCurrentCaregiver();
  const allocated = usePatientCaregivers(patientId);
  const unallocate = useUnallocatePatient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const isAdmin = me.data?.provider_role === 'admin';

  const sharedness =
    (allocated.data?.length ?? 0) >= 2
      ? 'Shared'
      : (allocated.data?.length ?? 0) === 1
        ? 'Sole-assigned'
        : 'Unassigned';

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Allocated caregivers</CardTitle>
            <CardDescription>
              {sharedness} · {allocated.data?.length ?? 0} caregiver
              {allocated.data?.length === 1 ? '' : 's'}
            </CardDescription>
          </div>
          {isAdmin && (
            <Button onClick={() => setPickerOpen(true)} size="sm">
              <Plus className="h-4 w-4" />
              Add caregiver
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {allocated.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {allocated.isSuccess && allocated.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No caregivers allocated.
              {isAdmin && ' Use "Add caregiver" to assign one from your provider.'}
            </p>
          )}
          {allocated.isSuccess && allocated.data.length > 0 && (
            <ul className="divide-y divide-border/60">
              {allocated.data.map((c) => {
                const isSelf = c.id === me.data?.id;
                const role = c.provider_role ?? 'member';
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-space-400 text-eggshell-500">
                        {role === 'admin' ? (
                          <Shield className="h-4 w-4" />
                        ) : (
                          <UserIcon className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {c.full_name}
                          {isSelf && (
                            <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                          )}
                        </p>
                        {/* Item 86: peer email is not exposed via the
                            directory RPC; show role as the secondary line. */}
                        <p className="truncate text-xs text-muted-foreground">
                          {role === 'admin' ? 'Administrator' : 'Member'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                        {role === 'admin' ? 'Admin' : 'Member'}
                      </Badge>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={unallocate.isPending}
                          onClick={() => unallocate.mutate({ patientId, caregiverId: c.id })}
                          aria-label="Remove allocation"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AllocatePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} patientId={patientId} />
    </section>
  );
}

function AllocatePickerDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const candidates = useUnallocatedMembers(patientId);
  const allocate = useAllocatePatient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add caregiver</DialogTitle>
          <DialogDescription>
            Pick a member of your provider to allocate to this patient.
          </DialogDescription>
        </DialogHeader>

        {candidates.isLoading && <p className="text-sm text-muted-foreground">Loading members…</p>}
        {candidates.isSuccess && candidates.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No more members to allocate. Invite teammates from the Provider settings page.
          </p>
        )}
        {candidates.isSuccess && candidates.data.length > 0 && (
          <ul className="divide-y divide-border/60">
            {candidates.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.full_name}</p>
                  {/* Item 86: peer email is not exposed via the directory RPC. */}
                  <p className="truncate text-xs text-muted-foreground">
                    {c.provider_role === 'admin' ? 'Administrator' : 'Member'}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={allocate.isPending}
                  onClick={() =>
                    allocate.mutate(
                      { patientId, caregiverId: c.id },
                      { onSuccess: () => onOpenChange(false) },
                    )
                  }
                >
                  Allocate
                </Button>
              </li>
            ))}
          </ul>
        )}
        {allocate.isError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(allocate.error as Error).message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
