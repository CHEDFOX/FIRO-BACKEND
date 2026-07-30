import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../shared/ids';
import { CATALOG_REPOSITORY, CatalogRepository } from '../../catalog/domain/catalog.repository';
import { isPublished } from '../../catalog/domain/experience';
import {
  COLLECTION_ITEM_REPOSITORY,
  COLLECTION_REPOSITORY,
  Collection,
  CollectionItem,
  CollectionItemRepository,
  CollectionRepository,
  DEFAULT_COLLECTION_NAME,
  DEFAULT_COLLECTION_SLUG,
} from '../domain/collection';

export interface SaveExperienceCommand {
  readonly userId: string;
  readonly experienceId: string;
  /** Defaults to the user's "Saved" collection. */
  readonly collectionId?: string;
  readonly note?: string;
}

export interface SaveExperienceResult {
  readonly item: CollectionItem;
  readonly collection: Collection;
  /** False when the experience was already saved (the call is idempotent). */
  readonly created: boolean;
}

/**
 * Saving is the single most important explicit signal in the product: it feeds
 * the personal map and is the strongest input to Explorer DNA. It is idempotent
 * so a double-tap can never create duplicates.
 */
@Injectable()
export class SaveExperienceUseCase {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collections: CollectionRepository,
    @Inject(COLLECTION_ITEM_REPOSITORY) private readonly items: CollectionItemRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  async execute(command: SaveExperienceCommand): Promise<SaveExperienceResult> {
    const experience = await this.catalog.findExperienceById(command.experienceId);
    if (!experience || !isPublished(experience)) {
      throw AppError.notFound('catalog.experience_not_found', 'Experience not found', {
        experienceId: command.experienceId,
      });
    }

    const collection = command.collectionId
      ? await this.requireOwnedCollection(command.userId, command.collectionId)
      : await this.ensureDefaultCollection(command.userId);

    const existing = await this.items.find(command.userId, experience.id, collection.id);
    if (existing) {
      return { item: existing, collection, created: false };
    }

    const item: CollectionItem = {
      id: uuidv7(),
      collectionId: collection.id,
      userId: command.userId,
      experienceId: experience.id,
      note: command.note?.trim() || null,
      savedAt: new Date().toISOString(),
    };
    await this.items.add(item);

    const updated: Collection = {
      ...collection,
      itemCount: await this.items.countForCollection(collection.id),
      updatedAt: new Date().toISOString(),
    };
    await this.collections.save(updated);

    return { item, collection: updated, created: true };
  }

  private async requireOwnedCollection(userId: string, collectionId: string): Promise<Collection> {
    const collection = await this.collections.findById(collectionId);
    if (!collection) {
      throw AppError.notFound('discovery.collection_not_found', 'Collection not found', {
        collectionId,
      });
    }
    if (collection.userId !== userId) {
      // Do not reveal that someone else's collection exists.
      throw AppError.notFound('discovery.collection_not_found', 'Collection not found', {
        collectionId,
      });
    }
    return collection;
  }

  /** Every user gets a "Saved" collection lazily, on first save. */
  private async ensureDefaultCollection(userId: string): Promise<Collection> {
    const existing = await this.collections.findDefaultForUser(userId);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const collection: Collection = {
      id: uuidv7(),
      userId,
      name: DEFAULT_COLLECTION_NAME,
      slug: DEFAULT_COLLECTION_SLUG,
      isDefault: true,
      isPrivate: true,
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.collections.save(collection);
    return collection;
  }
}
