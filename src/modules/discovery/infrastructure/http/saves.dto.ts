import { z } from 'zod';

export const SaveExperienceSchema = z.object({
  experienceId: z.string().min(1).max(100),
  collectionId: z.string().min(1).max(100).optional(),
  note: z.string().trim().max(500).optional(),
});
export type SaveExperienceInput = z.infer<typeof SaveExperienceSchema>;

export const UnsaveQuerySchema = z.object({
  collectionId: z.string().min(1).max(100).optional(),
});
export type UnsaveQueryInput = z.infer<typeof UnsaveQuerySchema>;
