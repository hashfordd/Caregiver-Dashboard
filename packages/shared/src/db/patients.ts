import { z } from 'zod';

export const Patient = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  dob: z.string().date().nullable(),
  description: z.string().nullable(),
  primary_caregiver_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});
export type Patient = z.infer<typeof Patient>;

export const CreatePatientInput = z.object({
  full_name: z.string().min(1, 'Required').max(120),
  dob: z.string().date().nullable().optional().or(z.literal('')),
  description: z.string().max(2000).nullable().optional().or(z.literal('')),
});
export type CreatePatientInput = z.infer<typeof CreatePatientInput>;

export const UpdatePatientInput = z.object({
  full_name: z.string().min(1, 'Required').max(120),
  dob: z.string().date().nullable().optional().or(z.literal('')),
  description: z.string().max(2000).nullable().optional().or(z.literal('')),
});
export type UpdatePatientInput = z.infer<typeof UpdatePatientInput>;

export const PatientNote = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  author_caregiver_id: z.string().uuid().nullable(),
  author_name: z.string(),
  body: z.string(),
  created_at: z.string().datetime(),
});
export type PatientNote = z.infer<typeof PatientNote>;

export const CreatePatientNoteInput = z.object({
  body: z.string().trim().min(1, 'Required').max(4000),
});
export type CreatePatientNoteInput = z.infer<typeof CreatePatientNoteInput>;
