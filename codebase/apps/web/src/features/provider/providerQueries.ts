import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CaregiverProfile,
  CareProvider,
  CaregiverInvite,
  CaregiverProviderRole,
} from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

// Item 86: peer caregiver email + company_name closed at the RLS layer.
// Surfaces that previously selected from caregivers for in-tenant peers
// (Members section, allocation pickers) now go through this RPC, which
// returns only id + full_name + provider_role.
type DirectoryEntry = Pick<CaregiverProfile, 'id' | 'full_name' | 'provider_role'>;
async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase.rpc('get_caregiver_directory');
  if (error) throw error;
  return (data ?? []) as DirectoryEntry[];
}

const CAREGIVER_PROFILE_COLUMNS =
  'id, email, full_name, role, company_name, care_provider_id, provider_role';

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export function useCurrentCaregiver() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['caregiver', 'me', user?.id],
    queryFn: async (): Promise<CaregiverProfile | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('caregivers')
        .select(CAREGIVER_PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as CaregiverProfile) ?? null;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
}

export function useCurrentProvider() {
  const me = useCurrentCaregiver();
  const providerId = me.data?.care_provider_id ?? null;
  return useQuery({
    queryKey: ['care-provider', providerId],
    queryFn: async (): Promise<CareProvider | null> => {
      if (!providerId) return null;
      const { data, error } = await supabase
        .from('care_providers')
        .select('id, name, created_at')
        .eq('id', providerId)
        .maybeSingle();
      if (error) throw error;
      return (data as CareProvider) ?? null;
    },
    enabled: !!providerId,
    staleTime: 30_000,
  });
}

export function useProviderMembers() {
  const me = useCurrentCaregiver();
  const providerId = me.data?.care_provider_id ?? null;
  return useQuery({
    queryKey: ['care-provider', 'members', providerId],
    queryFn: fetchDirectory,
    enabled: !!providerId,
    staleTime: 30_000,
  });
}

export function useProviderInvites() {
  const me = useCurrentCaregiver();
  const providerId = me.data?.care_provider_id ?? null;
  return useQuery({
    queryKey: ['care-provider', 'invites', providerId],
    queryFn: async (): Promise<CaregiverInvite[]> => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from('caregiver_invites')
        .select(
          'id, care_provider_id, email, role, token, invited_by, expires_at, accepted_at, created_at',
        )
        .eq('care_provider_id', providerId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CaregiverInvite[];
    },
    enabled: !!providerId,
    staleTime: 30_000,
  });
}

// Caregivers in the current provider, NOT yet allocated to a given patient.
// Used by the patient-allocation picker. Item 86: directory RPC, not raw
// caregivers select — exposes id + full_name + provider_role only.
export function useUnallocatedMembers(patientId: string) {
  const me = useCurrentCaregiver();
  const providerId = me.data?.care_provider_id ?? null;
  return useQuery({
    queryKey: ['care-provider', 'unallocated', providerId, patientId],
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (!providerId || !patientId) return [];
      const members = await fetchDirectory();
      const { data: allocated, error: allocErr } = await supabase
        .from('caregiver_patient')
        .select('caregiver_id')
        .eq('patient_id', patientId);
      if (allocErr) throw allocErr;
      const allocatedIds = new Set(
        (allocated ?? []).map((r: { caregiver_id: string }) => r.caregiver_id),
      );
      return members.filter((m) => !allocatedIds.has(m.id));
    },
    enabled: !!providerId && !!patientId,
  });
}

// Caregivers allocated to a specific patient. Item 86: peer rows are
// hidden by RLS; resolve via the directory RPC instead of joining
// caregivers in the SELECT.
export function usePatientCaregivers(patientId: string) {
  return useQuery({
    queryKey: ['caregiver_patient', 'patient', patientId],
    queryFn: async (): Promise<DirectoryEntry[]> => {
      if (!patientId) return [];
      const { data: rows, error } = await supabase
        .from('caregiver_patient')
        .select('caregiver_id')
        .eq('patient_id', patientId);
      if (error) throw error;
      const allocatedIds = new Set(
        ((rows ?? []) as { caregiver_id: string }[]).map((r) => r.caregiver_id),
      );
      const directory = await fetchDirectory();
      return directory
        .filter((c) => allocatedIds.has(c.id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    enabled: !!patientId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<CareProvider> => {
      const { data, error } = await supabase.rpc('create_care_provider', { p_name: name });
      if (error) throw error;
      return data as CareProvider;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['caregiver', 'me'] });
      qc.invalidateQueries({ queryKey: ['care-provider'] });
      toast.success('Care provider created', { description: data.name });
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useInviteCaregiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: CaregiverProviderRole }) => {
      const { data, error } = await supabase.rpc('invite_caregiver', {
        p_email: input.email,
        p_role: input.role,
      });
      if (error) throw error;
      return data as CaregiverInvite;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['care-provider', 'invites'] });
      toast.success('Invite sent', { description: data.email });
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string): Promise<CaregiverProfile> => {
      const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
      if (error) throw error;
      return data as CaregiverProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caregiver', 'me'] });
      qc.invalidateQueries({ queryKey: ['care-provider'] });
      toast.success('Invite accepted');
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['care-provider', 'invites'] });
      toast.success('Invite revoked');
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useAllocatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; caregiverId: string }) => {
      const { error } = await supabase.rpc('allocate_patient', {
        p_patient_id: input.patientId,
        p_caregiver_id: input.caregiverId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['caregiver_patient', 'patient', variables.patientId] });
      qc.invalidateQueries({ queryKey: ['care-provider', 'unallocated'] });
    },
  });
}

export function useUnallocatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; caregiverId: string }) => {
      const { error } = await supabase.rpc('unallocate_patient', {
        p_patient_id: input.patientId,
        p_caregiver_id: input.caregiverId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['caregiver_patient', 'patient', variables.patientId] });
      qc.invalidateQueries({ queryKey: ['care-provider', 'unallocated'] });
    },
  });
}

export function useUpdateProviderName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; name: string }) => {
      const { error } = await supabase
        .from('care_providers')
        .update({ name: input.name })
        .eq('id', input.providerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['care-provider'] });
      toast.success('Provider name updated');
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

// Items 79+80+83: role changes go through the SECURITY DEFINER RPC
// (set_caregiver_role) with admin-of-same-tenant + last-admin guards.
// The prior direct UPDATE on caregivers was a silent no-op because the
// caregivers self-update RLS policy filtered out peer rows; the new
// trigger-backed lockdown also makes direct UPDATE on
// provider_role / care_provider_id raise.
export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { caregiverId: string; role: CaregiverProviderRole }) => {
      const { error } = await supabase.rpc('set_caregiver_role', {
        p_target_id: input.caregiverId,
        p_role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['care-provider', 'members'] });
      qc.invalidateQueries({ queryKey: ['caregiver', 'me'] });
      toast.success('Role updated');
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase II.E — provider home overview + audit log
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderOverview {
  provider_id: string;
  patient_count: number;
  caregiver_count: number;
  admin_count: number;
  open_alerts_count: number;
  unresolved_incidents_24h: number;
  doses_logged_24h: number;
  notes_logged_24h: number;
  avg_ack_minutes_7d: number | null;
}

export function useProviderOverview() {
  return useQuery({
    queryKey: ['care-provider', 'overview'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<ProviderOverview | null> => {
      const { data, error } = await supabase.rpc('get_provider_overview');
      if (error) throw error;
      const rows = (data ?? []) as ProviderOverview[];
      return rows[0] ?? null;
    },
  });
}

export interface ProviderAuditEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export function useProviderAuditLog(limit = 100) {
  return useQuery({
    queryKey: ['care-provider', 'audit-log', limit],
    queryFn: async (): Promise<ProviderAuditEntry[]> => {
      const { data, error } = await supabase.rpc('get_provider_audit_log', {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as ProviderAuditEntry[];
    },
  });
}
