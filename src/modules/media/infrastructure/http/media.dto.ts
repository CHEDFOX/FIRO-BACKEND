import { z } from 'zod';

export const MediaListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).max(120).optional(),
});
export type MediaListQueryInput = z.infer<typeof MediaListQuerySchema>;
