import { z } from 'zod';
import { CaregiverProviderRole } from './care-providers.ts';

export const CaregiverRole = z.enum(['professional', 'family']);
export type CaregiverRole = z.infer<typeof CaregiverRole>;

export const CaregiverProfile = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().min(1),
  role: CaregiverRole,
  company_name: z.string().nullable().optional(),
  // Provider tenancy (Phase B). Nullable for new auth signups before
  // they bind to a provider via create_care_provider or accept_invite.
  care_provider_id: z.string().uuid().nullable().optional(),
  provider_role: CaregiverProviderRole.optional(),
});
export type CaregiverProfile = z.infer<typeof CaregiverProfile>;
