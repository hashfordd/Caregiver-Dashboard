import { z } from 'zod';
import { CaregiverProviderRole } from './care-providers.ts';

export const CaregiverRole = z.enum(['professional', 'family']);
export type CaregiverRole = z.infer<typeof CaregiverRole>;

export const TemperatureUnit = z.enum(['c', 'f']);
export type TemperatureUnit = z.infer<typeof TemperatureUnit>;

export const CaregiverProfile = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().min(1),
  role: CaregiverRole,
  company_name: z.string().nullable().optional(),
  // F4 / UI-05: display preference; readings are always stored in Celsius.
  // Optional for backward-compat with rows/selects predating the column.
  temperature_unit: TemperatureUnit.optional(),
  // Provider tenancy (Phase B). Nullable for new auth signups before
  // they bind to a provider via create_care_provider or accept_invite.
  care_provider_id: z.string().uuid().nullable().optional(),
  provider_role: CaregiverProviderRole.optional(),
});
export type CaregiverProfile = z.infer<typeof CaregiverProfile>;
