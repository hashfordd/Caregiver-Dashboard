import { z } from 'zod';

export const MedicationAdminStatus = z.enum(['given', 'refused', 'skipped', 'missed']);
export type MedicationAdminStatus = z.infer<typeof MedicationAdminStatus>;

export const Medication = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  name: z.string(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  // V1 schedule shape: { times: ["08:00","20:00"], tz: string } | null
  schedule: z
    .object({
      times: z.array(z.string()).optional(),
      tz: z.string().optional(),
    })
    .nullable(),
  prn: z.boolean(),
  active: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Medication = z.infer<typeof Medication>;

export const MedicationAdministration = z.object({
  id: z.string().uuid(),
  medication_id: z.string().uuid(),
  scheduled_for: z.string().datetime().nullable(),
  administered_at: z.string().datetime().nullable(),
  administered_by: z.string().uuid().nullable(),
  status: MedicationAdminStatus,
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type MedicationAdministration = z.infer<typeof MedicationAdministration>;

export const CreateMedicationInput = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  dose: z.string().trim().max(80).optional().or(z.literal('')),
  route: z.string().trim().max(40).optional().or(z.literal('')),
  prn: z.boolean().default(false),
  schedule_times: z
    .array(z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'))
    .max(8)
    .default([]),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type CreateMedicationInput = z.infer<typeof CreateMedicationInput>;

export const LogAdministrationInput = z.object({
  status: MedicationAdminStatus,
  scheduled_for: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});
export type LogAdministrationInput = z.infer<typeof LogAdministrationInput>;
