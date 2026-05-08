import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Device } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeTime } from '@/lib/time';
import { PairDeviceDialog } from './PairDeviceDialog';
import { UnpairButton } from './UnpairButton';

interface DevicePairingPanelProps {
  patientId: string;
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
  const query = useQuery({
    queryKey: ['devices', patientId],
    queryFn: () => fetchDevices(patientId),
    refetchInterval: 5000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">Devices</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Pair device
        </Button>
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
            {query.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-mono text-sm">{d.mac_address}</div>
                  {d.label && <div className="text-xs text-muted-foreground">{d.label}</div>}
                  <div className="text-xs text-muted-foreground">
                    Last seen: {relativeTime(d.last_seen_at)}
                  </div>
                </div>
                <UnpairButton deviceId={d.id} patientId={patientId} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <PairDeviceDialog open={open} onOpenChange={setOpen} patientId={patientId} />
    </Card>
  );
}
