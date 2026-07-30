import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_REPOSITORY, CatalogRepository } from '../../catalog/domain/catalog.repository';
import { Experience } from '../../catalog/domain/experience';
import {
  COLLECTION_ITEM_REPOSITORY,
  COLLECTION_REPOSITORY,
  Collection,
  CollectionItemRepository,
  CollectionRepository,
} from '../domain/collection';

export interface SavedExperience {
  readonly experience: Experience;
  readonly savedAt: string;
  readonly note: string | null;
  readonly collectionId: string;
}

@Injectable()
export class ListSavedUseCase {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collections: CollectionRepository,
    @Inject(COLLECTION_ITEM_REPOSITORY) private readonly items: CollectionItemRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  /** Everything a user has saved, newest first. */
  async execute(userId: string): Promise<SavedExperience[]> {
    const items = await this.items.listForUser(userId);
    if (items.length === 0) {
      return [];
    }

    const experiences = await this.catalog.findExperiencesByIds(
      items.map((item) => item.experienceId),
    );
    const byId = new Map(experiences.map((experience) => [experience.id, experience]));

    return items.flatMap((item) => {
      const experience = byId.get(item.experienceId);
      // Skip saves whose experience was archived/removed rather than 404 the page.
      return experience
        ? [
            {
              experience,
              savedAt: item.savedAt,
              note: item.note,
              collectionId: item.collectionId,
            },
          ]
        : [];
    });
  }

  async listCollections(userId: string): Promise<Collection[]> {
    return this.collections.listForUser(userId);
  }

  /** The id set behind the personal world map and feed "saved" badges. */
  async savedIds(userId: string): Promise<Set<string>> {
    const items = await this.items.listForUser(userId);
    return new Set(items.map((item) => item.experienceId));
  }
}
