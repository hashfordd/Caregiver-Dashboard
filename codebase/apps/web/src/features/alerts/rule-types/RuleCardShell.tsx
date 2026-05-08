import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AlertSeverity } from '@alzcare/shared';

interface RuleCardShellProps {
  title: string;
  type: string;
  severity: AlertSeverity;
  enabled: boolean;
  onSeverityChange: (severity: AlertSeverity) => void;
  onEnabledChange: (enabled: boolean) => void;
  onDelete?: () => void;
  saveDisabled: boolean;
  saving: boolean;
  onSave: () => void;
  saveError?: string | null;
  preview?: ReactNode;
  children: ReactNode;
}

const SEVERITY_COLOURS: Record<AlertSeverity, string> = {
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  critical: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

/** Shared chrome for the four rule-type cards: header (title + type
 *  badge), severity / enabled controls, body slot for type-specific
 *  params, footer (Save + Delete + preview). Keeps each rule card file
 *  focused on its own params form. */
export function RuleCardShell({
  title,
  type,
  severity,
  enabled,
  onSeverityChange,
  onEnabledChange,
  onDelete,
  saveDisabled,
  saving,
  onSave,
  saveError,
  preview,
  children,
}: RuleCardShellProps) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {type}
            </Badge>
            <span
              className={cn('rounded-full px-2 py-0.5 text-[10px]', SEVERITY_COLOURS[severity])}
            >
              {severity}
            </span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Enabled
          </label>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Severity">
            <select
              value={severity}
              onChange={(e) => onSeverityChange(e.target.value as AlertSeverity)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="info">info — 15 min cooldown</option>
              <option value="warn">warn — 5 min cooldown</option>
              <option value="critical">critical — 1 min cooldown</option>
            </select>
          </FieldLabel>
        </div>

        <div className="space-y-3 border-t border-border/60 pt-3">{children}</div>

        {preview && (
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {preview}
          </div>
        )}

        {saveError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {saveError}
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <Button size="sm" disabled={saveDisabled || saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          )}
        </footer>
      </CardContent>
    </Card>
  );
}

interface FieldLabelProps {
  label: string;
  children: ReactNode;
}

export function FieldLabel({ label, children }: FieldLabelProps) {
  return (
    <label className="block space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
