import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import {
  COLLECTION_ITEM_REPOSITORY,
  COLLECTION_REPOSITORY,
  CollectionItemRepository,
  CollectionRepository,
} from '../domain/collection';

export interface UnsaveExperienceCommand {
  readonly userId: string;
  readonly experienceId: string;
  readonly collectionId?: string;
}

@Injectable()
export class UnsaveExperienceUseCase {
  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collections: CollectionRepository,
    @Inject(COLLECTION_ITEM_REPOSITORY) private readonly items: CollectionItemRepository,
  ) {}

  /** Idempotent: removing something that is not saved is a no-op, not an error. */
  async execute(command: UnsaveExperienceCommand): Promise<{ removed: boolean }> {
    const collection = command.collectionId
      ? await this.collections.findById(command.collectionId)
      : await this.collections.findDefaultForUser(command.userId);

    if (!collection) {
      return { removed: false };
    }
    if (collection.userId !== command.userId) {
      throw AppError.notFound('discovery.collection_not_found', 'Collection not found');
    }

    const removed = await this.items.remove(command.userId, command.experienceId, collection.id);
    if (removed) {
      await this.collections.save({
        ...collection,
        itemCount: await this.items.countForCollection(collection.id),
        updatedAt: new Date().toISOString(),
      });
    }
    return { removed };
  }
}
