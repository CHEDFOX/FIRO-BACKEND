import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { MediaAsset, MediaVariant } from '../../domain/media-asset';
import type {
  MediaAssetPage,
  MediaAssetQuery,
  MediaAssetRepository,
} from '../../domain/media-asset.repository';

interface AssetRow {
  id: string;
  sha256: string;
  original_filename: string | null;
  original_content_type: string;
  original_bytes: string;
  original_path: string;
  width: number;
  height: number;
  dominant_color: string;
  variants: MediaVariant[];
  attribution: string | null;
  alt: string | null;
  uploaded_by: string;
  created_at: Date;
}

const COLUMNS = `
  id, sha256, original_filename, original_content_type, original_bytes::text,
  original_path, width, height, dominant_color, variants, attribution, alt,
  uploaded_by, created_at
`;

function toAsset(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    sha256: row.sha256,
    originalFilename: row.original_filename,
    originalContentType: row.original_content_type,
    originalBytes: Number(row.original_bytes),
    originalPath: row.original_path,
    width: row.width,
    height: row.height,
    dominantColor: row.dominant_color,
    variants: row.variants ?? [],
    attribution: row.attribution,
    alt: row.alt,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class PostgresMediaAssetRepository implements MediaAssetRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<MediaAsset | null> {
    const row = await this.db.queryOne<AssetRow>(
      `SELECT ${COLUMNS} FROM media.assets WHERE id = $1`,
      [id],
    );
    return row ? toAsset(row) : null;
  }

  async findBySha256(sha256: string): Promise<MediaAsset | null> {
    const row = await this.db.queryOne<AssetRow>(
      `SELECT ${COLUMNS} FROM media.assets WHERE sha256 = $1`,
      [sha256],
    );
    return row ? toAsset(row) : null;
  }

  async list(query: MediaAssetQuery): Promise<MediaAssetPage> {
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];

    if (query.search) {
      params.push(`%${query.search}%`);
      const index = params.length;
      where.push(`(original_filename ILIKE $${index} OR alt ILIKE $${index})`);
    }
    const filter = where.join(' AND ');

    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM media.assets WHERE ${filter}`,
      params,
    );

    params.push(query.limit, query.offset);
    const rows = await this.db.query<AssetRow>(
      `SELECT ${COLUMNS} FROM media.assets
       WHERE ${filter}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { rows: rows.map(toAsset), total: Number(total?.count ?? 0) };
  }

  async save(asset: MediaAsset): Promise<void> {
    await this.db.query(
      `INSERT INTO media.assets
         (id, sha256, original_filename, original_content_type, original_bytes,
          original_path, width, height, dominant_color, variants, attribution, alt,
          uploaded_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (sha256) DO UPDATE SET
         attribution = EXCLUDED.attribution,
         alt = EXCLUDED.alt`,
      [
        asset.id,
        asset.sha256,
        asset.originalFilename,
        asset.originalContentType,
        asset.originalBytes,
        asset.originalPath,
        asset.width,
        asset.height,
        asset.dominantColor,
        JSON.stringify(asset.variants),
        asset.attribution,
        asset.alt,
        asset.uploadedBy,
        asset.createdAt,
      ],
    );
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM media.assets WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  /**
   * Counts catalogue rows whose media array contains this asset id.
   *
   * A containment test against the JSONB column rather than a join, because
   * media is embedded in the experience row by design (see the note on
   * migration 003).
   */
  async referenceCount(assetId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM catalog.experiences
       WHERE media @> $1::jsonb`,
      [JSON.stringify([{ id: assetId }])],
    );
    return row ? Number(row.count) : 0;
  }
}
