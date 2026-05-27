import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Settings2, Wifi } from 'lucide-react';
import type { Device } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PairDeviceDialog } from './PairDeviceDialog';
import { HardwareSetupWizard } from './HardwareSetupWizard';
import { UnpairButton } from './UnpairButton';

interface DevicePairingPanelProps {
  patientId: string;
}

// A device is "receiving" if it has sent data recently; "setup" if it has never
// sent any (paired but the hardware connection isn't established yet — e.g. the
// wizard was exited before the first reading); "idle" if it sent data but has
// since gone quiet.
const RECEIVING_MS = 2 * 60 * 1000;
type DeviceStatus = 'receiving' | 'idle' | 'setup';

function deviceStatus(d: Device): DeviceStatus {
  if (!d.last_seen_at) return 'setup';
  return Date.now() - new Date(d.last_seen_at).getTime() < RECEIVING_MS ? 'receiving' : 'idle';
}

const STATUS_META: Record<DeviceStatus, { dot: string; label: string; pulse?: boolean }> = {
  receiving: { dot: 'bg-emerald-500', label: 'Receiving data', pulse: true },
  idle: { dot: 'bg-muted-foreground/40', label: 'No recent data' },
  setup: { dot: 'bg-amber-500', label: 'Setting up — no data yet', pulse: true },
};

function StatusBadge({ status }: { status: DeviceStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('h-2 w-2 rounded-full', meta.dot, meta.pulse && 'animate-pulse')} />
      {meta.label}
    </span>
  );
}

async function fetchDevices(patientId: string): Promise<Device[]> {
  const { data, error } = await supabase
    .from('devices')
    .select('id, mac_address, firmware_version, label, paired_patient_id, last_seen_at, created_at')
    .eq('paired_patient_id', patientId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Device[];
}

export function DevicePairingPanel({ patientId }: DevicePairingPanelProps) {
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  // When set, the wizard resumes an already-paired device at the Firmware step.
  const [resumeMac, setResumeMac] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: ['devices', patientId],
    queryFn: () => fetchDevices(patientId),
    refetchInterval: 5000,
  });

  function startNew() {
    setResumeMac(undefined);
    setWizardOpen(true);
  }
  function resume(mac: string) {
    setResumeMac(mac);
    setWizardOpen(true);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Devices</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Pair device
          </Button>
          <Button size="sm" onClick={startNew}>
            <Wifi className="mr-1 h-4 w-4" />
            Set up hardware
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading && <Skeleton className="h-12 w-full" />}

        {query.isError && (
          <p className="text-sm text-destructive">
            {(query.error as Error).message || 'Failed to load devices'}
          </p>
        )}

        {query.isSuccess && query.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No devices paired yet.</p>
        )}

        {query.isSuccess && query.data.length > 0 && (
          <ul className="divide-y" aria-label="Paired devices">
            {query.data.map((d) => {
              const status = deviceStatus(d);
              return (
                <li key={d.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{d.mac_address}</div>
                    {d.label && <div className="text-xs text-muted-foreground">{d.label}</div>}
                    <div className="mt-0.5">
                      <StatusBadge status={status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last seen: {relativeTime(d.last_seen_at)}
                    </div>
                    {/* Connection details for wiring firmware / the protocol-shim:
                        the device publishes to device/{patient}/telemetry with this
                        device_id. Click a value to select it for copying. */}
                    <div className="mt-1 select-all break-all font-mono text-[10px] text-muted-foreground">
                      device_id: {d.id}
                    </div>
                    <div className="select-all break-all font-mono text-[10px] text-muted-foreground">
                      topic: device/{patientId}/telemetry
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {status === 'setup' ? (
                      <Button size="xs" variant="outline" onClick={() => resume(d.mac_address)}>
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        Resume setup
                      </Button>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Re-open setup"
                        title="Re-open setup"
                        onClick={() => resume(d.mac_address)}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    )}
                    <UnpairButton deviceId={d.id} patientId={patientId} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <PairDeviceDialog open={open} onOpenChange={setOpen} patientId={patientId} />
      <HardwareSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        patientId={patientId}
        resumeMac={resumeMac}
      />
    </Card>
  );
}
