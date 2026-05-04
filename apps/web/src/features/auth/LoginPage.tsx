import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

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
      <div className="w-full max-w-sm space-y-8">
        <Brand size="lg" tagline />
        <Card>
          <CardContent className="pt-6">
            <div className="mb-6 space-y-1">
              <h1 className="font-serif italic text-2xl text-foreground">Welcome back</h1>
              <p className="text-sm text-muted-foreground">
                Sign in to monitor allocated patients in real time.
              </p>
            </div>
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
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              {info && (
                <p className="rounded-md bg-accent/10 px-3 py-2 text-sm text-foreground/80">
                  {info}
                </p>
              )}
              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? 'Signing in…' : mode === 'magic' ? 'Send magic link' : 'Sign in'}
              </Button>
              <button
                type="button"
                onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
                className="block w-full text-center text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {mode === 'magic' ? '← Use password instead' : 'Email me a magic link →'}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link to="/signup" className="text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
