import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CaregiverRole } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCurrentCaregiver } from '@/features/provider/providerQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const profileSchema = z.object({
  full_name: z.string().min(1, 'Required'),
  role: CaregiverRole,
  company_name: z.string().max(120).optional().or(z.literal('')),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

// Item 84: profile data goes through useCurrentCaregiver — single
// source of truth shared with the navbar so the Admin badge doesn't
// race the profile form's column-narrower fetch.
export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const profileQuery = useCurrentCaregiver();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: '', role: 'family', company_name: '' },
  });

  useEffect(() => {
    if (profileQuery.data) {
      form.reset({
        full_name: profileQuery.data.full_name,
        role: profileQuery.data.role,
        company_name: profileQuery.data.company_name ?? '',
      });
    }
  }, [profileQuery.data, form]);

  const updateMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const payload = {
        full_name: values.full_name,
        role: values.role,
        company_name: values.company_name?.trim() ? values.company_name.trim() : null,
      };
      const { error } = await supabase.from('caregivers').update(payload).eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['caregiver', 'me'] }),
  });

  if (profileQuery.isLoading) {
    return (
      <main className="grid min-h-[60vh] place-items-center px-6">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (profileQuery.isError) {
    return (
      <main className="mx-auto max-w-xl px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load your profile</CardTitle>
            <CardDescription>
              {(profileQuery.error as Error).message || 'Unknown error'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => profileQuery.refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const profile = profileQuery.data;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Account</p>
        <h1 className="font-serif italic text-4xl text-foreground">Your profile</h1>
        <p className="text-sm text-muted-foreground">
          Update how your name appears on patient handovers and link the company you provide care
          for.
        </p>
      </header>
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" disabled value={profile?.email ?? ''} />
              <p className="text-xs text-muted-foreground">Email changes aren't supported in V1.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  type="text"
                  {...form.register('full_name')}
                  aria-invalid={form.formState.errors.full_name ? true : undefined}
                />
                {form.formState.errors.full_name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.full_name.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={form.watch('role')}
                  onValueChange={(v) =>
                    form.setValue('role', v as ProfileFormValues['role'], { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="role" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CaregiverRole.options.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r === 'professional' ? 'Professional caregiver' : 'Family caregiver'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company_name">Company</Label>
              <Input
                id="company_name"
                type="text"
                placeholder="St. Vincent's Home Care"
                {...form.register('company_name')}
              />
              <p className="text-xs text-muted-foreground">
                The organisation you provide care for. Optional for family caregivers.
              </p>
            </div>
            {updateMutation.isError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {(updateMutation.error as Error).message}
              </p>
            )}
            {updateMutation.isSuccess && (
              <p className="rounded-md bg-accent/10 px-3 py-2 text-sm text-foreground/80">Saved.</p>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PasswordSection />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password change — supabase.auth.updateUser({ password }) on the current
// session. Lives below the profile form so demo accounts can rotate the
// shared demo1234! after first login.
// ─────────────────────────────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    new_password: z.string().min(8, 'At least 8 characters'),
    confirm_password: z.string().min(8, 'At least 8 characters'),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
type PasswordFormValues = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { new_password: '', confirm_password: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      const { error } = await supabase.auth.updateUser({ password: values.new_password });
      if (error) throw error;
    },
    onSuccess: () => form.reset({ new_password: '', confirm_password: '' }),
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Update the password you use to sign in. Minimum 8 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                type="password"
                autoComplete="new-password"
                {...form.register('new_password')}
                aria-invalid={form.formState.errors.new_password ? true : undefined}
              />
              {form.formState.errors.new_password && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.new_password.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_password">Confirm new password</Label>
              <Input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                {...form.register('confirm_password')}
                aria-invalid={form.formState.errors.confirm_password ? true : undefined}
              />
              {form.formState.errors.confirm_password && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.confirm_password.message}
                </p>
              )}
            </div>
          </div>

          {mutation.isError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(mutation.error as Error).message}
            </p>
          )}
          {mutation.isSuccess && (
            <p className="rounded-md bg-accent/10 px-3 py-2 text-sm text-foreground/80">
              Password updated. You'll stay signed in on this device.
            </p>
          )}

          <div className="pt-2">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
