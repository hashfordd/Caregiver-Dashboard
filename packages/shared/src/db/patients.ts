import { z } from 'zod';

export const Patient = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  dob: z.string().date().nullable(),
  description: z.string().nullable(),
  care_provider_id: z.string().uuid(),
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

// Phase C item 35: author_name is no longer stored. The UI resolves the
// author's display name via PostgREST embed on the
// caregivers!author_caregiver_id relation; the embed is optional so
// notes whose author has been removed from the provider still render.
export const PatientNote = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  author_caregiver_id: z.string().uuid().nullable(),
  body: z.string(),
  created_at: z.string().datetime(),
  author: z
    .object({
      full_name: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type PatientNote = z.infer<typeof PatientNote>;

export const CreatePatientNoteInput = z.object({
  body: z.string().trim().min(1, 'Required').max(4000),
});
export type CreatePatientNoteInput = z.infer<typeof CreatePatientNoteInput>;

export const UpdatePatientNoteInput = z.object({
  body: z.string().trim().min(1, 'Required').max(4000),
});
export type UpdatePatientNoteInput = z.infer<typeof UpdatePatientNoteInput>;
