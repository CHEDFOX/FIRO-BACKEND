import type { MediaAsset } from './media-asset';

export interface MediaAssetQuery {
  readonly limit: number;
  readonly offset: number;
  /** Matches the original filename or the alt text. */
  readonly search?: string;
}

export interface MediaAssetPage {
  readonly rows: readonly MediaAsset[];
  readonly total: number;
}

export interface MediaAssetRepository {
  findById(id: string): Promise<MediaAsset | null>;
  /** Dedupe lookup: the same photo uploaded twice is the same asset. */
  findBySha256(sha256: string): Promise<MediaAsset | null>;
  list(query: MediaAssetQuery): Promise<MediaAssetPage>;
  save(asset: MediaAsset): Promise<void>;
  delete(id: string): Promise<boolean>;
  /**
   * How many catalogue rows reference this asset.
   *
   * Deleting an asset that is still on a published card replaces a photograph
   * with a broken image for every user at once, so the use case checks first.
   */
  referenceCount(assetId: string): Promise<number>;
}

export const MEDIA_ASSET_REPOSITORY = Symbol('MEDIA_ASSET_REPOSITORY');
