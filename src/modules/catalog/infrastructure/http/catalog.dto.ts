import { z } from 'zod';
import { ALL_TAGS } from '../../domain/taxonomy';

const tagEnum = z.enum(ALL_TAGS as unknown as [string, ...string[]]);

/** Comma-separated tags in a query string -> a validated tag array. */
const tagsParam = z
  .string()
  .optional()
  .transform((value) => (value ? value.split(',').map((part) => part.trim()) : undefined))
  .pipe(z.array(tagEnum).max(10).optional());

export const BrowseExperiencesQuerySchema = z.object({
  tags: tagsParam,
  country: z.string().length(2).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type BrowseExperiencesQueryInput = z.infer<typeof BrowseExperiencesQuerySchema>;

export const MapViewQuerySchema = z.object({
  south: z.coerce.number().min(-90).max(90),
  west: z.coerce.number().min(-180).max(180),
  north: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  zoom: z.coerce.number().min(0).max(22).default(3),
  /** When true, restrict the map to the caller's saved experiences. */
  saved: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type MapViewQueryInput = z.infer<typeof MapViewQuerySchema>;
