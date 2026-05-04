import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Mode = 'password' | 'magic';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('password');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (mode === 'magic') {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (otpError) setError(otpError.message);
      else setInfo('Check your email for the sign-in link.');
    } else {
      const { error: pwError } = await supabase.auth.signInWithPassword({ email, password });
      if (pwError) setError(pwError.message);
      else navigate('/');
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen grid place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-serif italic text-3xl">Caregiver dashboard</CardTitle>
          <CardDescription>Sign in to monitor allocated patients in real time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            {mode === 'password' && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Signing in…' : mode === 'magic' ? 'Send magic link' : 'Sign in'}
            </Button>
            <button
              type="button"
              onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
              className="block w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {mode === 'magic' ? 'Use password instead' : 'Email me a magic link'}
            </button>
            {/* TODO: F1 — wire signup flow with role selection (professional / family). */}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
