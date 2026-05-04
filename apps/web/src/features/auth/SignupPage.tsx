import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CaregiverRole } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

type Mode = 'form' | 'verify-email';
type Role = (typeof CaregiverRole.options)[number];

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('family');
  const [mode, setMode] = useState<Mode>('form');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role },
        emailRedirectTo: window.location.origin,
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      navigate('/');
    } else {
      setMode('verify-email');
    }
    setLoading(false);
  }

  if (mode === 'verify-email') {
    return (
      <main className="min-h-screen grid place-items-center bg-background p-6">
        <div className="w-full max-w-sm space-y-8">
          <Brand size="lg" tagline />
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1">
                <h1 className="font-serif italic text-2xl text-foreground">Check your inbox</h1>
                <p className="text-sm text-muted-foreground">
                  A confirmation link was sent to{' '}
                  <span className="font-medium text-foreground">{email}</span>. Open it to finish
                  creating your account.
                </p>
              </div>
              <Link
                to="/login"
                className="inline-block text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                ← Back to sign in
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <Brand size="lg" tagline />
        <Card>
          <CardContent className="pt-6">
            <div className="mb-6 space-y-1">
              <h1 className="font-serif italic text-2xl text-foreground">Create an account</h1>
              <p className="text-sm text-muted-foreground">
                For caregivers monitoring patients via the wearable.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {CaregiverRole.options.map((r) => (
                    <option key={r} value={r}>
                      {r === 'professional' ? 'Professional caregiver' : 'Family caregiver'}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? 'Creating account…' : 'Create account'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          Already here?{' '}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
