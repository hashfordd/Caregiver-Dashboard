import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  CaregiverProfile,
  CareProvider,
  CaregiverInvite,
  CaregiverProviderRole,
} from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

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
    queryFn: async (): Promise<CaregiverProfile[]> => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from('caregivers')
        .select(CAREGIVER_PROFILE_COLUMNS)
        .eq('care_provider_id', providerId)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CaregiverProfile[];
    },
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
        .select('id, care_provider_id, email, role, token, invited_by, expires_at, accepted_at, created_at')
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
// Used by the patient-allocation picker.
export function useUnallocatedMembers(patientId: string) {
  const me = useCurrentCaregiver();
  const providerId = me.data?.care_provider_id ?? null;
  return useQuery({
    queryKey: ['care-provider', 'unallocated', providerId, patientId],
    queryFn: async (): Promise<CaregiverProfile[]> => {
      if (!providerId || !patientId) return [];
      const { data: members, error: membersErr } = await supabase
        .from('caregivers')
        .select(CAREGIVER_PROFILE_COLUMNS)
        .eq('care_provider_id', providerId);
      if (membersErr) throw membersErr;
      const { data: allocated, error: allocErr } = await supabase
        .from('caregiver_patient')
        .select('caregiver_id')
        .eq('patient_id', patientId);
      if (allocErr) throw allocErr;
      const allocatedIds = new Set((allocated ?? []).map((r: { caregiver_id: string }) => r.caregiver_id));
      return ((members ?? []) as CaregiverProfile[]).filter((m) => !allocatedIds.has(m.id));
    },
    enabled: !!providerId && !!patientId,
  });
}

// Caregivers allocated to a specific patient — joined with caregivers row
// for full_name / role display in the patient detail "Caregivers" tab.
export function usePatientCaregivers(patientId: string) {
  return useQuery({
    queryKey: ['caregiver_patient', 'patient', patientId],
    queryFn: async (): Promise<CaregiverProfile[]> => {
      if (!patientId) return [];
      const { data, error } = await supabase
        .from('caregiver_patient')
        .select(`caregiver:caregivers!caregiver_id ( ${CAREGIVER_PROFILE_COLUMNS} )`)
        .eq('patient_id', patientId);
      if (error) throw error;
      type Row = { caregiver: CaregiverProfile | null };
      return ((data ?? []) as unknown as Row[])
        .map((r) => r.caregiver)
        .filter((c): c is CaregiverProfile => !!c)
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caregiver', 'me'] });
      qc.invalidateQueries({ queryKey: ['care-provider'] });
    },
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care-provider', 'invites'] }),
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
    },
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care-provider', 'invites'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care-provider'] }),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { caregiverId: string; role: CaregiverProviderRole }) => {
      // Direct UPDATE — RLS gates this to admins via the
      // caregivers_self_or_peer_read SELECT policy plus the caregivers_self_update
      // policy (admins of the provider can update peers). If a future
      // migration requires an RPC for promote/demote, swap here.
      const { error } = await supabase
        .from('caregivers')
        .update({ provider_role: input.role })
        .eq('id', input.caregiverId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['care-provider', 'members'] }),
  });
}
