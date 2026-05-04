import { Link, NavLink as RouterNavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, User as UserIcon } from 'lucide-react';
import type { CaregiverProfile } from '@alzcare/shared';
import { Brand } from '@/components/Brand';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const NAV_LINKS = [
  { to: '/patients', label: 'Patients' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/history', label: 'Reports' },
] as const;

async function fetchCurrentProfile(userId: string): Promise<CaregiverProfile | null> {
  const { data, error } = await supabase
    .from('caregivers')
    .select('id, email, full_name, role, company_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as CaregiverProfile) ?? null;
}

function initials(fullName: string | null | undefined): string {
  if (!fullName) return '?';
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function firstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName.split(/\s+/)[0] ?? '';
}

export function AppNavbar() {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchCurrentProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-8">
          <Link to="/patients" aria-label="Home">
            <Brand size="sm" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {profile.data?.company_name && (
            <span className="hidden text-xs uppercase tracking-[0.16em] text-muted-foreground lg:inline">
              {profile.data.company_name}
            </span>
          )}
          <ThemeToggle />
          <UserMenu profile={profile.data ?? null} />
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <RouterNavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )
      }
    >
      {children}
    </RouterNavLink>
  );
}

function UserMenu({ profile }: { profile: CaregiverProfile | null }) {
  const navigate = useNavigate();
  const name = profile?.full_name ?? '';

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-space-400 font-serif italic text-foreground">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{firstName(name)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <p className="text-sm font-medium leading-none">{name || 'Caregiver'}</p>
            <p className="text-xs text-muted-foreground">{profile?.email ?? ''}</p>
            {profile?.company_name && (
              <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {profile.company_name}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserIcon className="mr-2 h-4 w-4" />
            Profile &amp; company
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
