import { z } from 'zod';

export const DementiaStage = z.enum(['unknown', 'early', 'moderate', 'advanced']);
export type DementiaStage = z.infer<typeof DementiaStage>;

export const WanderingRisk = z.enum(['low', 'medium', 'high']);
export type WanderingRisk = z.infer<typeof WanderingRisk>;

export const Patient = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  dob: z.string().date().nullable(),
  description: z.string().nullable(),
  care_provider_id: z.string().uuid(),
  created_at: z.string().datetime(),
  // Phase II.B care plan + risk profile.
  dementia_stage: DementiaStage,
  wandering_risk: WanderingRisk,
  known_triggers: z.array(z.string()),
  care_plan_summary: z.string().nullable(),
  preferences: z.record(z.string(), z.unknown()),
  // F9 care-setting (home base). Numerics come back as numbers via
  // PostgREST. Both lat and lng are NULL or both are set — enforced by
  // a DB-side check constraint (patients_care_setting_paired).
  care_setting_lat: z.number().nullable(),
  care_setting_lng: z.number().nullable(),
  care_setting_label: z.string().nullable(),
});
export type Patient = z.infer<typeof Patient>;

export const CareSettingInput = z
  .object({
    care_setting_lat: z.number().min(-90).max(90).nullable(),
    care_setting_lng: z.number().min(-180).max(180).nullable(),
    care_setting_label: z.string().trim().max(120).nullable(),
  })
  .refine((v) => (v.care_setting_lat == null) === (v.care_setting_lng == null), {
    message: 'Latitude and longitude must both be set or both be cleared.',
    path: ['care_setting_lat'],
  });
export type CareSettingInput = z.infer<typeof CareSettingInput>;

export const CarePlanInput = z.object({
  dementia_stage: DementiaStage,
  wandering_risk: WanderingRisk,
  known_triggers: z.array(z.string().trim().min(1).max(80)).max(20),
  care_plan_summary: z.string().max(4000).nullable().optional().or(z.literal('')),
});
export type CarePlanInput = z.infer<typeof CarePlanInput>;

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
