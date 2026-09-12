import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type {
  Collection,
  CollectionItem,
  CollectionItemRepository,
  CollectionRepository,
} from '../../domain/collection';

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  is_private: boolean;
  item_count: number;
  created_at: Date;
  updated_at: Date;
}

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    isDefault: row.is_default,
    isPrivate: row.is_private,
    itemCount: row.item_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COL_COLUMNS = `
  id, user_id, name, slug, is_default, is_private, item_count, created_at, updated_at
`;

@Injectable()
export class PostgresCollectionRepository implements CollectionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<Collection | null> {
    const row = await this.db.queryOne<CollectionRow>(
      `SELECT ${COL_COLUMNS} FROM discovery.collections WHERE id = $1`,
      [id],
    );
    return row ? toCollection(row) : null;
  }

  async findDefaultForUser(userId: string): Promise<Collection | null> {
    const row = await this.db.queryOne<CollectionRow>(
      `SELECT ${COL_COLUMNS} FROM discovery.collections
       WHERE user_id = $1 AND is_default`,
      [userId],
    );
    return row ? toCollection(row) : null;
  }

  async listForUser(userId: string): Promise<Collection[]> {
    const rows = await this.db.query<CollectionRow>(
      `SELECT ${COL_COLUMNS} FROM discovery.collections
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [userId],
    );
    return rows.map(toCollection);
  }

  async save(collection: Collection): Promise<void> {
    await this.db.query(
      `INSERT INTO discovery.collections
         (id, user_id, name, slug, is_default, is_private, item_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         is_private = EXCLUDED.is_private,
         item_count = EXCLUDED.item_count,
         updated_at = EXCLUDED.updated_at`,
      [
        collection.id,
        collection.userId,
        collection.name,
        collection.slug,
        collection.isDefault,
        collection.isPrivate,
        collection.itemCount,
        collection.createdAt,
        collection.updatedAt,
      ],
    );
  }
}

interface ItemRow {
  id: string;
  collection_id: string;
  user_id: string;
  experience_id: string;
  note: string | null;
  saved_at: Date;
}

function toItem(row: ItemRow): CollectionItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    userId: row.user_id,
    experienceId: row.experience_id,
    note: row.note,
    savedAt: row.saved_at.toISOString(),
  };
}

const ITEM_COLUMNS = `id, collection_id, user_id, experience_id, note, saved_at`;

@Injectable()
export class PostgresCollectionItemRepository implements CollectionItemRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async add(item: CollectionItem): Promise<void> {
    // DO NOTHING rather than an error: saving is idempotent by design, and the
    // unique index makes that safe even under concurrent double-taps.
    await this.db.query(
      `INSERT INTO discovery.collection_items
         (id, collection_id, user_id, experience_id, note, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (collection_id, experience_id) DO NOTHING`,
      [item.id, item.collectionId, item.userId, item.experienceId, item.note, item.savedAt],
    );
  }

  async remove(userId: string, experienceId: string, collectionId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM discovery.collection_items
       WHERE user_id = $1 AND experience_id = $2 AND collection_id = $3
       RETURNING id`,
      [userId, experienceId, collectionId],
    );
    return rows.length > 0;
  }

  async find(
    userId: string,
    experienceId: string,
    collectionId: string,
  ): Promise<CollectionItem | null> {
    const row = await this.db.queryOne<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM discovery.collection_items
       WHERE user_id = $1 AND experience_id = $2 AND collection_id = $3`,
      [userId, experienceId, collectionId],
    );
    return row ? toItem(row) : null;
  }

  async listForUser(userId: string): Promise<CollectionItem[]> {
    const rows = await this.db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM discovery.collection_items
       WHERE user_id = $1 ORDER BY saved_at DESC`,
      [userId],
    );
    return rows.map(toItem);
  }

  async listForCollection(collectionId: string): Promise<CollectionItem[]> {
    const rows = await this.db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM discovery.collection_items
       WHERE collection_id = $1 ORDER BY saved_at DESC`,
      [collectionId],
    );
    return rows.map(toItem);
  }

  async countForCollection(collectionId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM discovery.collection_items WHERE collection_id = $1`,
      [collectionId],
    );
    return row ? Number(row.count) : 0;
  }

  async savedExperienceIds(userId: string, experienceIds: readonly string[]): Promise<Set<string>> {
    if (experienceIds.length === 0) {
      return new Set();
    }
    const rows = await this.db.query<{ experience_id: string }>(
      `SELECT experience_id FROM discovery.collection_items
       WHERE user_id = $1 AND experience_id = ANY($2)`,
      [userId, experienceIds],
    );
    return new Set(rows.map((row) => row.experience_id));
  }
}
