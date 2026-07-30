import { Injectable } from '@nestjs/common';
import {
  Collection,
  CollectionItem,
  CollectionItemRepository,
  CollectionRepository,
} from '../../domain/collection';

@Injectable()
export class InMemoryCollectionRepository implements CollectionRepository {
  private readonly byId = new Map<string, Collection>();

  async findById(id: string): Promise<Collection | null> {
    return this.byId.get(id) ?? null;
  }

  async findDefaultForUser(userId: string): Promise<Collection | null> {
    for (const collection of this.byId.values()) {
      if (collection.userId === userId && collection.isDefault) {
        return collection;
      }
    }
    return null;
  }

  async listForUser(userId: string): Promise<Collection[]> {
    return [...this.byId.values()]
      .filter((collection) => collection.userId === userId)
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async save(collection: Collection): Promise<void> {
    this.byId.set(collection.id, collection);
  }
}

@Injectable()
export class InMemoryCollectionItemRepository implements CollectionItemRepository {
  private readonly byId = new Map<string, CollectionItem>();

  async add(item: CollectionItem): Promise<void> {
    this.byId.set(item.id, item);
  }

  async remove(userId: string, experienceId: string, collectionId: string): Promise<boolean> {
    for (const [id, item] of this.byId) {
      if (
        item.userId === userId &&
        item.experienceId === experienceId &&
        item.collectionId === collectionId
      ) {
        this.byId.delete(id);
        return true;
      }
    }
    return false;
  }

  async find(
    userId: string,
    experienceId: string,
    collectionId: string,
  ): Promise<CollectionItem | null> {
    for (const item of this.byId.values()) {
      if (
        item.userId === userId &&
        item.experienceId === experienceId &&
        item.collectionId === collectionId
      ) {
        return item;
      }
    }
    return null;
  }

  async listForUser(userId: string): Promise<CollectionItem[]> {
    return [...this.byId.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async listForCollection(collectionId: string): Promise<CollectionItem[]> {
    return [...this.byId.values()]
      .filter((item) => item.collectionId === collectionId)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async countForCollection(collectionId: string): Promise<number> {
    let count = 0;
    for (const item of this.byId.values()) {
      if (item.collectionId === collectionId) {
        count += 1;
      }
    }
    return count;
  }

  async savedExperienceIds(userId: string, experienceIds: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(experienceIds);
    const saved = new Set<string>();
    for (const item of this.byId.values()) {
      if (item.userId === userId && wanted.has(item.experienceId)) {
        saved.add(item.experienceId);
      }
    }
    return saved;
  }
}
