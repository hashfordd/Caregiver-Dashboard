import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AlertRow as AlertRowT } from '@alzcare/shared';
import { AlertRow } from './AlertRow';
import { useAllocatedAlerts } from './useAllocatedAlerts';

const POPOVER_LIMIT = 6;

/** Header bell. Subscribes to every allocated patient's alerts via a
 *  single realtime channel; the badge counts unacked, the popover lists
 *  the most recent N unacked entries. Critical-severity unacked is
 *  surfaced as a red dot rather than just the neutral count. */
export function AlertBell() {
  const { rows, unackedCount, hasCritical } = useAllocatedAlerts();
  const unacked = rows.filter((r) => r.acknowledged_at == null).slice(0, POPOVER_LIMIT);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Alerts">
          <Bell className="h-5 w-5" />
          {unackedCount > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white',
                hasCritical ? 'bg-red-600' : 'bg-amber-500',
              )}
            >
              {unackedCount > 99 ? '99+' : unackedCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Unacked alerts</span>
          <Link to="/alerts" className="text-xs text-primary underline-offset-4 hover:underline">
            View all
          </Link>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {unacked.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No unacked alerts. Quiet patients are happy patients.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-2 py-2">
            {unacked.map((row) => (
              <PopoverRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PopoverRow({ row }: { row: AlertRowT }) {
  return (
    <AlertRow
      alert={row}
      patientHref={`/patients/${row.patient_id}?tab=alerts`}
      patientLabel={`Patient ${row.patient_id.slice(0, 8)}`}
    />
  );
}
