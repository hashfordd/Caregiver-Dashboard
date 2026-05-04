import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LandingPage() {
  const { user } = useAuth();

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <h1 className="font-serif italic text-3xl text-foreground">Caregiver dashboard</h1>
        <Button variant="outline" onClick={handleSignOut}>
          Sign out
        </Button>
      </header>
      <section className="mx-auto mt-12 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {user?.email}</CardTitle>
            <CardDescription>
              Foundational scaffold only. Patient roster, live monitoring, floor plan editor, and
              alert workflows arrive in F2 onwards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Next features to wire: patient roster (F2) and patient detail dashboard (F3).
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
