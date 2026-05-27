import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Check, Copy, Loader2, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import type { Device } from '@alzcare/shared';
import { TelemetryMessage, buildDeviceTopic, buildTopic } from '@alzcare/shared/mqtt';
import { supabase } from '@/lib/supabase';
import { useBroker } from '@/lib/broker/BrokerProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Stepper } from '@/components/ui/stepper';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const STEPS = ['Connect', 'Pair', 'Firmware', 'Verify'] as const;

const PairSchema = z.object({
  mac_address: z
    .string()
    .regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i, 'expected MAC like aa:bb:cc:dd:ee:ff'),
  label: z.string().max(60).optional(),
});
type PairValues = z.infer<typeof PairSchema>;

interface HardwareSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}

export function HardwareSetupWizard({ open, onOpenChange, patientId }: HardwareSetupWizardProps) {
  const [step, setStep] = useState(0);
  const [mac, setMac] = useState<string>('');

  // Reset to a clean wizard whenever it's opened.
  useEffect(() => {
    if (open) {
      setStep(0);
      setMac('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Set up hardware</DialogTitle>
          <DialogDescription>
            Connect to the broker, pair the wearable, point its firmware at the right topic, then
            watch the first reading arrive.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Stepper steps={[...STEPS]} current={step} />
        </div>

        <div className="min-h-[15rem]">
          {step === 0 && <ConnectStep onNext={() => setStep(1)} />}
          {step === 1 && (
            <PairStep
              patientId={patientId}
              onPaired={(m) => {
                setMac(m);
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <FirmwareStep mac={mac} onBack={() => setStep(1)} onNext={() => setStep(3)} />
          )}
          {step === 3 && (
            <VerifyStep
              patientId={patientId}
              mac={mac}
              onBack={() => setStep(2)}
              onDone={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: connect to the broker ───────────────────────────────────────────
function ConnectStep({ onNext }: { onNext: () => void }) {
  const { status, error, connect, host } = useBroker();
  const connected = status === 'connected';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-border/60 p-4">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full',
            connected ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground',
          )}
        >
          {connected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {connected ? 'Connected to HiveMQ' : 'Not connected to the broker'}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {status === 'unconfigured'
              ? 'No read-only credential set (VITE_MQTT_RO_*).'
              : (host ?? 'HiveMQ Cloud')}
            {status === 'error' && error ? ` · ${error}` : ''}
          </div>
        </div>
        {!connected && status !== 'unconfigured' && (
          <Button size="sm" onClick={() => connect()} disabled={status === 'connecting'}>
            {status === 'connecting' || status === 'reconnecting' ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Connecting…
              </>
            ) : (
              'Connect to server'
            )}
          </Button>
        )}
      </div>

      {status === 'unconfigured' && (
        <p className="text-xs text-muted-foreground">
          The live feed is off. Pairing and persisted data still work through the ingest server —
          you can continue. To enable the direct low-latency feed, add a read-only HiveMQ credential
          to <code className="font-mono">apps/web/.env.local</code> (
          <code>VITE_MQTT_RO_USERNAME</code> / <code>VITE_MQTT_RO_PASSWORD</code>) and reload.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={status === 'connecting'}>
          {connected ? 'Next' : 'Continue anyway'}
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: pair the device (MAC → patient) ─────────────────────────────────
function PairStep({
  patientId,
  onPaired,
  onBack,
}: {
  patientId: string;
  onPaired: (mac: string) => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<PairValues>({
    resolver: zodResolver(PairSchema),
    defaultValues: { mac_address: '', label: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: PairValues): Promise<Device> => {
      const { data, error } = await supabase.rpc('pair_device', {
        p_mac_address: values.mac_address.toLowerCase(),
        p_patient_id: patientId,
        p_label: values.label || null,
      });
      if (error) throw error;
      return data as Device;
    },
    onSuccess: (_data, values) => {
      queryClient.invalidateQueries({ queryKey: ['devices', patientId] });
      onPaired(values.mac_address.toLowerCase());
    },
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the wearable's MAC address. It pairs to this patient so the broker routes its data to
        the right place.
      </p>
      <div className="space-y-2">
        <Label htmlFor="wiz_mac">MAC address</Label>
        <Input
          id="wiz_mac"
          autoFocus
          placeholder="aa:bb:cc:dd:ee:ff"
          autoComplete="off"
          {...form.register('mac_address')}
          aria-invalid={form.formState.errors.mac_address ? true : undefined}
        />
        {form.formState.errors.mac_address && (
          <p className="text-sm text-destructive">{form.formState.errors.mac_address.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="wiz_label">Label (optional)</Label>
        <Input id="wiz_label" placeholder="wrist left" {...form.register('label')} />
      </div>
      {mutation.isError && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Pairing…' : 'Pair device'}
        </Button>
      </div>
    </form>
  );
}

// ── Step 3: firmware connection details ─────────────────────────────────────
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded bg-muted px-2 py-1 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            toast.success(`${label} copied`);
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function FirmwareStep({
  mac,
  onBack,
  onNext,
}: {
  mac: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const { host } = useBroker();
  const brokerHostShown = host ?? 'your-cluster.s1.eu.hivemq.cloud';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Point the wearable's firmware at the broker with these settings. Publish telemetry as JSON
        to the topic below; the bridge validates it and routes it to this patient.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <CopyRow label="Broker host" value={brokerHostShown} />
        <CopyRow label="Port (TLS)" value="8883" />
      </div>
      <CopyRow label="Telemetry topic" value={buildDeviceTopic(mac, 'telemetry')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <CopyRow label="Signals topic" value={buildDeviceTopic(mac, 'signals')} />
        <CopyRow label="Events topic" value={buildDeviceTopic(mac, 'events')} />
      </div>
      <p className="text-xs text-muted-foreground">
        Authenticate the device with your hardware's <strong>publish</strong> broker credential (the
        read-write user the firmware uses) — not the dashboard's read-only feed credential.
      </p>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}

// ── Step 4: verify data is flowing (direct from the broker) ─────────────────
function VerifyStep({
  patientId,
  mac,
  onBack,
  onDone,
}: {
  patientId: string;
  mac: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { status, subscribe } = useBroker();
  const [reading, setReading] = useState<TelemetryMessage | null>(null);

  useEffect(() => {
    if (status !== 'connected') return;
    const topics = [buildDeviceTopic(mac, 'telemetry'), buildTopic(patientId, 'telemetry')];
    const unsub = subscribe(topics, (_topic, payload) => {
      try {
        const parsed = TelemetryMessage.safeParse(JSON.parse(payload));
        if (parsed.success) setReading(parsed.data);
      } catch {
        /* ignore non-JSON */
      }
    });
    return unsub;
  }, [status, patientId, mac, subscribe]);

  const liveUnavailable = status !== 'connected';

  return (
    <div className="space-y-4">
      {reading ? (
        <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <Check className="h-5 w-5" />
            Device connected — data is flowing
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="HR" value={reading.hr_bpm} unit="bpm" />
            <Metric label="SpO₂" value={reading.spo2_pct} unit="%" />
            <Metric label="Temp" value={reading.temp_c} unit="°C" />
          </div>
        </div>
      ) : liveUnavailable ? (
        <div className="flex items-start gap-3 rounded-lg border border-border/60 p-4">
          <Server className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="text-sm">
            <div className="font-medium">Live verify unavailable — feed is off</div>
            <p className="text-xs text-muted-foreground">
              The browser isn't connected to the broker, so this step can't show live samples. Data
              still flows to the server once the device publishes — open the patient's Live tab to
              confirm. Connect the feed on step 1 to verify here directly.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 p-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <div className="text-sm">
            <div className="font-medium">Waiting for the first reading…</div>
            <p className="text-xs text-muted-foreground">
              Power on the wearable. Listening on{' '}
              <code className="font-mono">{buildDeviceTopic(mac, 'telemetry')}</code>.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          {!reading && !liveUnavailable && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              live
            </span>
          )}
          <Button onClick={onDone}>{reading ? 'Done' : 'Finish'}</Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value?: number | null; unit: string }) {
  return (
    <div className="rounded-md bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-lg tabular-nums">
        {typeof value === 'number' ? value.toFixed(label === 'Temp' ? 1 : 0) : '—'}
      </div>
      <div className="text-[10px] text-muted-foreground">{unit}</div>
    </div>
  );
}
