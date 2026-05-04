import { z } from 'zod';

export const Patient = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  dob: z.string().date().nullable(),
  notes: z.string().nullable(),
  primary_caregiver_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type Patient = z.infer<typeof Patient>;

export const CreatePatientInput = z.object({
  full_name: z.string().min(1, 'Required').max(120),
  dob: z.string().date().nullable().optional().or(z.literal('')),
  notes: z.string().max(2000).nullable().optional().or(z.literal('')),
});
export type CreatePatientInput = z.infer<typeof CreatePatientInput>;
