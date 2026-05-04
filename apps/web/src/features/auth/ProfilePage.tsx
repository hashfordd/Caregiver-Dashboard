import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CaregiverRole, type CaregiverProfile } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const profileSchema = z.object({
  full_name: z.string().min(1, 'Required'),
  role: CaregiverRole,
  company_name: z.string().max(120).optional().or(z.literal('')),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

async function fetchProfile(userId: string): Promise<CaregiverProfile> {
  const { data, error } = await supabase
    .from('caregivers')
    .select('id, email, full_name, role, company_name')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data as CaregiverProfile;
}

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user!.id),
    enabled: !!user?.id,
  });

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', user?.id] }),
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
                <select
                  id="role"
                  {...form.register('role')}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {CaregiverRole.options.map((r) => (
                    <option key={r} value={r}>
                      {r === 'professional' ? 'Professional caregiver' : 'Family caregiver'}
                    </option>
                  ))}
                </select>
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
              <Button type="button" variant="outline" onClick={() => navigate('/patients')}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
