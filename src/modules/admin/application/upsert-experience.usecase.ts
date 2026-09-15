import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../../catalog/domain/catalog.repository';
import { CATALOG_WRITER, type CatalogWriter } from '../../catalog/domain/catalog-writer';
import type { Experience, ExperienceStatus, MediaRef } from '../../catalog/domain/experience';
import type { BudgetBand, Tag } from '../../catalog/domain/taxonomy';
import { ALL_MONTHS, seasonMaskFromMonths } from '../../catalog/domain/taxonomy';
import { AUDIT_LOG, type AuditLog } from '../domain/audit-log';

export interface UpsertExperienceCommand {
  /** Absent = create. Present = edit that row. */
  readonly id?: string;
  readonly placeId: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly story?: string | null;
  /** Defaults to the place's own coordinates. */
  readonly lat?: number;
  readonly lng?: number;
  readonly tags: readonly Tag[];
  readonly budgetBand: BudgetBand;
  /** Months (1-12) this is at its best. Empty/absent = all year. */
  readonly months?: readonly number[];
  readonly difficulty: number;
  readonly wowScore: number;
  readonly hiddenGemScore: number;
  readonly media: readonly MediaRef[];
  readonly status: ExperienceStatus;
}

export interface Actor {
  readonly id: string;
  readonly handle: string;
}

/**
 * Create or edit a catalogue entry from the console.
 *
 * Runs through the catalog's own writer port rather than the admin read model,
 * so the rules that make an experience *valid* (a real place, a unique slug)
 * are enforced in one place no matter who is writing. The console is a client
 * of the catalogue, not a back door into it.
 */
@Injectable()
export class UpsertExperienceUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(CATALOG_WRITER) private readonly writer: CatalogWriter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async execute(command: UpsertExperienceCommand, actor: Actor): Promise<Experience> {
    const slug = command.slug.trim().toLowerCase();

    const place = await this.catalog.findPlaceById(command.placeId);
    if (!place) {
      throw AppError.validation(
        'admin.unknown_place',
        `No place with id "${command.placeId}". Places are reference data — seed it first.`,
      );
    }

    const existing = command.id ? await this.catalog.findExperienceById(command.id) : null;
    if (command.id && !existing) {
      throw AppError.notFound('admin.experience_not_found', 'No such experience');
    }

    const slugOwner = await this.catalog.findExperienceBySlug(slug);
    if (slugOwner && slugOwner.id !== existing?.id) {
      throw AppError.conflict(
        'admin.slug_taken',
        `"${slug}" is already used by ${slugOwner.title}. Slugs appear in URLs, so they must be unique.`,
      );
    }

    const now = new Date().toISOString();
    const months = command.months ?? [];

    const experience: Experience = {
      id: existing?.id ?? idFromSlug(slug),
      placeId: place.id,
      slug,
      title: command.title.trim(),
      summary: command.summary.trim(),
      story: command.story?.trim() || null,
      coordinates: {
        lat: command.lat ?? place.coordinates.lat,
        lng: command.lng ?? place.coordinates.lng,
      },
      // De-duplicated: the same tag twice would count double in every DNA
      // update this experience ever contributes to.
      tags: [...new Set(command.tags)],
      budgetBand: command.budgetBand,
      seasonMask: months.length > 0 ? seasonMaskFromMonths([...months]) : ALL_MONTHS,
      difficulty: command.difficulty,
      wowScore: command.wowScore,
      hiddenGemScore: command.hiddenGemScore,
      media: [...command.media],
      status: command.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.writer.upsertExperience(experience);
    await this.audit.record({
      actorId: actor.id,
      actorHandle: actor.handle,
      action: existing ? 'experience.updated' : 'experience.created',
      targetType: 'experience',
      targetId: experience.id,
      before: existing,
      after: experience,
      at: now,
    });

    return experience;
  }
}

/**
 * Catalogue ids are readable editorial slugs ('exp_lofoten_blue_hour') rather
 * than UUIDs — they appear in seeds, fixtures and support conversations, and a
 * human needs to recognise them.
 */
function idFromSlug(slug: string): string {
  const normalised = slug.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `exp_${normalised}`;
}
