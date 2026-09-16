import { Injectable } from '@nestjs/common';
import { InMemoryCatalogRepository } from '../../../catalog/infrastructure/persistence/in-memory-catalog.repository';
import type { MediaAsset } from '../../domain/media-asset';
import type {
  MediaAssetPage,
  MediaAssetQuery,
  MediaAssetRepository,
} from '../../domain/media-asset.repository';

@Injectable()
export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  private readonly byId = new Map<string, MediaAsset>();

  // Depends on the concrete in-memory catalogue for the reference check, the
  // same concession the admin read model makes and for the same reason: no
  // product use case may scan the whole catalogue.
  constructor(private readonly catalog: InMemoryCatalogRepository) {}

  async findById(id: string): Promise<MediaAsset | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySha256(sha256: string): Promise<MediaAsset | null> {
    for (const asset of this.byId.values()) {
      if (asset.sha256 === sha256) {
        return asset;
      }
    }
    return null;
  }

  async list(query: MediaAssetQuery): Promise<MediaAssetPage> {
    let rows = [...this.byId.values()];

    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter(
        (asset) =>
          (asset.originalFilename ?? '').toLowerCase().includes(needle) ||
          (asset.alt ?? '').toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      rows: rows.slice(query.offset, query.offset + query.limit),
      total: rows.length,
    };
  }

  async save(asset: MediaAsset): Promise<void> {
    this.byId.set(asset.id, asset);
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }

  async referenceCount(assetId: string): Promise<number> {
    return this.catalog
      .listAllExperiences()
      .filter((experience) => experience.media.some((ref) => ref.id === assetId)).length;
  }
}
