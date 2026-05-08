import { useEffect, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import type { CaregiverInvite, CaregiverProviderRole } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInviteCaregiver } from '@/features/provider/providerQueries';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteCaregiverDialog({ open, onOpenChange }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CaregiverProviderRole>('member');
  const [issued, setIssued] = useState<CaregiverInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useInviteCaregiver();

  // Reset when the dialog re-opens for a fresh invite.
  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('member');
      setIssued(null);
      setCopied(false);
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const inviteUrl = issued
    ? `${window.location.origin}/invite/${encodeURIComponent(issued.token)}`
    : '';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate({ email: email.trim(), role }, { onSuccess: setIssued });
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard write may be blocked by the browser; the URL is already
      // visible in the input for the admin to copy manually.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a caregiver</DialogTitle>
          <DialogDescription>
            They'll receive a link to join {role === 'admin' ? 'as another admin' : 'this provider'}
            .
          </DialogDescription>
        </DialogHeader>

        {!issued && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite_email">Email</Label>
              <Input
                id="invite_email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="caregiver@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite_role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as CaregiverProviderRole)}>
                <SelectTrigger id="invite_role" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Members see allocated patients only. Admins see every patient in the provider and
                can invite teammates.
              </p>
            </div>
            {mutation.isError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {(mutation.error as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Generating…' : 'Generate invite'}
              </Button>
            </div>
          </form>
        )}

        {issued && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite_url">Invite link</Label>
              <div className="flex gap-2">
                <Input id="invite_url" readOnly value={inviteUrl} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={handleCopy}>
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with {issued.email}. It expires in 7 days.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
