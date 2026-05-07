import { z } from 'zod';

export const CaregiverProviderRole = z.enum(['admin', 'member']);
export type CaregiverProviderRole = z.infer<typeof CaregiverProviderRole>;

export const CareProvider = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  created_at: z.string().datetime(),
});
export type CareProvider = z.infer<typeof CareProvider>;

export const CaregiverInvite = z.object({
  id: z.string().uuid(),
  care_provider_id: z.string().uuid(),
  email: z.string().email(),
  role: CaregiverProviderRole,
  token: z.string(),
  invited_by: z.string().uuid(),
  expires_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type CaregiverInvite = z.infer<typeof CaregiverInvite>;
