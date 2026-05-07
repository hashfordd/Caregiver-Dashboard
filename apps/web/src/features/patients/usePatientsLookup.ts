import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Looks up patient display names by id, scoped to the caller's
 *  allocations + provider via RLS. Used by alert surfaces to replace
 *  UUID-prefix labels ("Patient 11111111") with real names.
 *
 *  Cached under a dedicated key (not the roster cache) so this hook
 *  can stay a thin "id → name" lookup without coupling to the
 *  roster query's column shape. */
const KEY = ['patients', 'lookup'] as const;

export interface PatientLookup {
  byId: Map<string, string>;
  resolve: (id: string | null | undefined) => string;
}

export function usePatientsLookup(): PatientLookup {
  const query = useQuery({
    queryKey: KEY,
    staleTime: 60_000,
    queryFn: async (): Promise<Array<{ id: string; full_name: string }>> => {
      const { data, error } = await supabase.from('patients').select('id, full_name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
  });

  const byId = new Map<string, string>();
  for (const row of query.data ?? []) byId.set(row.id, row.full_name);

  return {
    byId,
    resolve: (id) => {
      if (!id) return 'Unknown patient';
      const name = byId.get(id);
      if (name) return name;
      // Fall back to a short UUID prefix while the lookup loads.
      return `Patient ${id.slice(0, 8)}`;
    },
  };
}
