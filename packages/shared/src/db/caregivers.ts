import { z } from 'zod';

export const CaregiverRole = z.enum(['professional', 'family']);
export type CaregiverRole = z.infer<typeof CaregiverRole>;

export const CaregiverProfile = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().min(1),
  role: CaregiverRole,
  company_name: z.string().nullable().optional(),
});
export type CaregiverProfile = z.infer<typeof CaregiverProfile>;
