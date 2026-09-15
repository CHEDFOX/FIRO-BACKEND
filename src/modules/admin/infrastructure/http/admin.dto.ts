import { z } from 'zod';
import { ExperienceStatus } from '../../../catalog/domain/experience';
import { ALL_TAGS, BudgetBand } from '../../../catalog/domain/taxonomy';
import { ALL_ROLES } from '../../../identity/domain/role';
import { UserStatus } from '../../../identity/domain/user';

const tagEnum = z.enum(ALL_TAGS as unknown as [string, ...string[]]);
const statusEnum = z.enum([
  ExperienceStatus.DRAFT,
  ExperienceStatus.PUBLISHED,
  ExperienceStatus.ARCHIVED,
]);

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).max(120).optional(),
});

export const UserListQuerySchema = PageQuerySchema.extend({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DELETED]).optional(),
  role: z.enum(ALL_ROLES as unknown as [string, ...string[]]).optional(),
});
export type UserListQueryInput = z.infer<typeof UserListQuerySchema>;

export const ContentListQuerySchema = PageQuerySchema.extend({
  status: statusEnum.optional(),
});
export type ContentListQueryInput = z.infer<typeof ContentListQuerySchema>;

export const ActivityQuerySchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ActivityQueryInput = z.infer<typeof ActivityQuerySchema>;

const MediaSchema = z.object({
  id: z.string().min(1).max(120),
  url: z.string().url(),
  dominantColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #1b2a41')
    .nullable()
    .default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  attribution: z.string().max(200).nullable().default(null),
});

/**
 * The catalogue editor's contract.
 *
 * Every editorial lever the ranking engine reads is here and nothing else is:
 * scores are bounded 0..1 because the scorer assumes that range, and a form
 * that could submit 12 would quietly poison the feed rather than fail.
 */
export const UpsertExperienceSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  placeId: z.string().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words separated by single hyphens'),
  title: z.string().trim().min(3).max(140),
  summary: z.string().trim().min(10).max(280),
  story: z.string().trim().max(8000).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  tags: z.array(tagEnum).min(1).max(12),
  budgetBand: z.enum([
    BudgetBand.BUDGET,
    BudgetBand.MODERATE,
    BudgetBand.PREMIUM,
    BudgetBand.LUXURY,
  ]),
  months: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  difficulty: z.number().int().min(1).max(5).default(1),
  wowScore: z.number().min(0).max(1).default(0.5),
  hiddenGemScore: z.number().min(0).max(1).default(0.5),
  media: z.array(MediaSchema).max(12).default([]),
  status: statusEnum.default(ExperienceStatus.DRAFT),
});
export type UpsertExperienceInput = z.infer<typeof UpsertExperienceSchema>;

export const SetUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DELETED]),
});
export type SetUserStatusInput = z.infer<typeof SetUserStatusSchema>;

export const SetUserRolesSchema = z.object({
  roles: z
    .array(z.enum(ALL_ROLES as unknown as [string, ...string[]]))
    .min(1)
    .max(3),
});
export type SetUserRolesInput = z.infer<typeof SetUserRolesSchema>;
