import { Coordinates } from './geo';
import { BudgetBand, SeasonMask, Tag } from './taxonomy';

export const ExperienceStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export type ExperienceStatus = (typeof ExperienceStatus)[keyof typeof ExperienceStatus];

export interface MediaRef {
  readonly id: string;
  readonly url: string;
  /** Dominant colour (hex) so the client can show a tasteful placeholder while loading. */
  readonly dominantColor: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly attribution: string | null;
}

/**
 * The atom of discovery. An Experience is a place *plus the feeling of going
 * there* — the thing the feed shows, the map pins, and the user saves.
 *
 * `tags` uses the shared taxonomy, which is the same vocabulary Explorer DNA
 * scores — that shared vocabulary is what makes matching possible without ML.
 */
export interface Experience {
  readonly id: string;
  readonly placeId: string;
  readonly slug: string;
  readonly title: string;
  /** One emotional line — the hook shown on a card. */
  readonly summary: string;
  /** Longer editorial body (CMS-owned later). */
  readonly story: string | null;
  readonly coordinates: Coordinates;
  readonly tags: Tag[];
  readonly budgetBand: BudgetBand;
  /** Bitmask of months this is at its best. */
  readonly seasonMask: SeasonMask;
  /** 1 (easy) .. 5 (demanding). */
  readonly difficulty: number;
  /** Editorial 0..1 — how strong this is as a "wow" moment; used by ranking. */
  readonly wowScore: number;
  /** Rarity 0..1 — 1 means a genuine hidden gem. Drives the novelty lever. */
  readonly hiddenGemScore: number;
  readonly media: MediaRef[];
  readonly status: ExperienceStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isPublished(experience: Experience): boolean {
  return experience.status === ExperienceStatus.PUBLISHED;
}

/** The projection sent to clients — hides editorial scoring signals. */
export interface PublicExperience {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly story: string | null;
  readonly coordinates: Coordinates;
  readonly tags: Tag[];
  readonly budgetBand: BudgetBand;
  readonly difficulty: number;
  readonly media: MediaRef[];
}

export function toPublicExperience(experience: Experience): PublicExperience {
  return {
    id: experience.id,
    slug: experience.slug,
    title: experience.title,
    summary: experience.summary,
    story: experience.story,
    coordinates: experience.coordinates,
    tags: experience.tags,
    budgetBand: experience.budgetBand,
    difficulty: experience.difficulty,
    media: experience.media,
  };
}
