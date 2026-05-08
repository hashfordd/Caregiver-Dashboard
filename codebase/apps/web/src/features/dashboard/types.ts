// Shape returned by public.get_situation_overview (Phase II.A migration).
//
// Numerics come back from supabase-js as strings on the wire; convert at
// the call site only when arithmetic is needed. The grid renders the
// last_position_mode + last_position_at directly, so the lat/lng/x/y
// fields are passthrough.

export interface PatientSituation {
  patient_id: string;
  full_name: string;
  care_provider_id: string;
  last_position_at: string | null;
  last_position_mode: 'indoor' | 'outdoor' | null;
  last_position_x: string | null;
  last_position_y: string | null;
  last_position_lat: string | null;
  last_position_lng: string | null;
  wandering_risk: string;
  // Phase II.C dashboard counts. Server-side bigint deserialises as
  // number for values within JS's safe-integer range — counts comfortably
  // fit. (PostgREST returns them as numbers, not strings.)
  unresolved_incidents_24h_count: number;
  active_medications_count: number;
}

export type ConnectionStatus = 'online' | 'stale' | 'offline';
