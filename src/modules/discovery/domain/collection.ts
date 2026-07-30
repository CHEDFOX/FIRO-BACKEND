/**
 * Collections are how a user keeps places: a save always lands in a collection
 * (a default "Saved" one unless they choose another), which is what later powers
 * the personal world map and feeds the taste signal into Explorer DNA.
 */

export interface Collection {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly slug: string;
  /** The auto-created default collection cannot be deleted or renamed away. */
  readonly isDefault: boolean;
  readonly isPrivate: boolean;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CollectionItem {
  readonly id: string;
  readonly collectionId: string;
  readonly userId: string;
  readonly experienceId: string;
  readonly note: string | null;
  readonly savedAt: string;
}

export const DEFAULT_COLLECTION_NAME = 'Saved';
export const DEFAULT_COLLECTION_SLUG = 'saved';

export interface CollectionRepository {
  findById(id: string): Promise<Collection | null>;
  findDefaultForUser(userId: string): Promise<Collection | null>;
  listForUser(userId: string): Promise<Collection[]>;
  save(collection: Collection): Promise<void>;
}

export interface CollectionItemRepository {
  add(item: CollectionItem): Promise<void>;
  remove(userId: string, experienceId: string, collectionId: string): Promise<boolean>;
  find(userId: string, experienceId: string, collectionId: string): Promise<CollectionItem | null>;
  /** Every save by a user, newest first — the source for the personal map. */
  listForUser(userId: string): Promise<CollectionItem[]>;
  listForCollection(collectionId: string): Promise<CollectionItem[]>;
  countForCollection(collectionId: string): Promise<number>;
  /** Which of these experiences has the user already saved? (for feed badges) */
  savedExperienceIds(userId: string, experienceIds: readonly string[]): Promise<Set<string>>;
}

export const COLLECTION_REPOSITORY = Symbol('COLLECTION_REPOSITORY');
export const COLLECTION_ITEM_REPOSITORY = Symbol('COLLECTION_ITEM_REPOSITORY');
