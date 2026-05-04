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
});
type ProfileFormValues = z.infer<typeof profileSchema>;

async function fetchProfile(userId: string): Promise<CaregiverProfile> {
  const { data, error } = await supabase
    .from('caregivers')
    .select('id, email, full_name, role')
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
    defaultValues: { full_name: '', role: 'family' },
  });

  useEffect(() => {
    if (profileQuery.data) {
      form.reset({
        full_name: profileQuery.data.full_name,
        role: profileQuery.data.role,
      });
    }
  }, [profileQuery.data, form]);

  const updateMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const { error } = await supabase.from('caregivers').update(values).eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', user?.id] }),
  });

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  if (profileQuery.isLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (profileQuery.isError) {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="w-full max-w-md">
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
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>Update your name and caregiver role.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" disabled value={profile?.email ?? ''} />
              </div>
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
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {CaregiverRole.options.map((r) => (
                    <option key={r} value={r}>
                      {r === 'professional' ? 'Professional caregiver' : 'Family caregiver'}
                    </option>
                  ))}
                </select>
              </div>
              {updateMutation.isError && (
                <p className="text-sm text-destructive">
                  {(updateMutation.error as Error).message}
                </p>
              )}
              {updateMutation.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
              <div className="flex gap-3">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/')}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
