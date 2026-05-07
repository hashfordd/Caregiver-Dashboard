import { useState } from 'react';
import { Link, NavLink as RouterNavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, LogOut, Menu as MenuIcon, User as UserIcon, X as XIcon } from 'lucide-react';
import type { CaregiverProfile } from '@alzcare/shared';
import { Brand } from '@/components/Brand';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AlertBell } from '@/features/alerts/AlertBell';
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
    .select('id, email, full_name, role, company_name, care_provider_id, provider_role')
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const profile = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchCurrentProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex items-center gap-2 md:gap-8">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
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
          <AlertBell />
          <ThemeToggle />
          <UserMenu profile={profile.data ?? null} />
        </div>
      </div>
      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </header>
  );
}

function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={onClose}
        className="absolute inset-0 bg-background/80 backdrop-blur"
      />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col gap-2 border-r border-border bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <Brand size="sm" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <nav className="mt-2 flex flex-col gap-1" aria-label="Primary mobile">
          {NAV_LINKS.map((l) => (
            <RouterNavLink
              key={l.to}
              to={l.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2.5 text-base font-medium transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )
              }
            >
              {l.label}
            </RouterNavLink>
          ))}
        </nav>
      </div>
    </div>
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
            <AvatarFallback className="bg-space-400 font-serif italic text-eggshell-500">
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
        <DropdownMenuItem asChild>
          <Link to="/provider">
            <Building2 className="mr-2 h-4 w-4" />
            Care provider
            {profile?.provider_role === 'admin' && (
              <span className="ml-2 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent-foreground">
                Admin
              </span>
            )}
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
