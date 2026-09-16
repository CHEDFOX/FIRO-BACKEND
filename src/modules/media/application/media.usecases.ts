import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../bootstrap/config';
import { AppError } from '../../../shared/errors/app-error';
import {
  type MediaAsset,
  type MediaRefProjection,
  toMediaRef,
  VARIANT_CONTENT_TYPE,
} from '../domain/media-asset';
import {
  MEDIA_ASSET_REPOSITORY,
  type MediaAssetPage,
  type MediaAssetQuery,
  type MediaAssetRepository,
} from '../domain/media-asset.repository';
import { MEDIA_STORAGE, type MediaStorage } from '../domain/media-storage';

/** Hard ceiling on a media page, so a hand-edited URL cannot dump the library. */
export const MAX_MEDIA_PAGE = 100;

@Injectable()
export class ListMediaUseCase {
  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(
    query: MediaAssetQuery,
  ): Promise<{ rows: MediaRefProjection[]; total: number; raw: MediaAssetPage }> {
    const page = await this.assets.list({
      ...query,
      limit: Math.min(query.limit, MAX_MEDIA_PAGE),
    });
    return {
      rows: page.rows.map((asset) => toMediaRef(asset, this.config.mediaBaseUrl)),
      total: page.total,
      raw: page,
    };
  }
}

@Injectable()
export class DeleteMediaUseCase {
  private readonly logger = new Logger(DeleteMediaUseCase.name);

  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async execute(id: string): Promise<void> {
    const asset = await this.assets.findById(id);
    if (!asset) {
      throw AppError.notFound('media.not_found', 'No such image.');
    }

    // Refuse while it is still on a card. Deleting a referenced image does not
    // fail loudly — it replaces a photograph with a broken image for every
    // user at once, which is the worst kind of bug to ship.
    const references = await this.assets.referenceCount(id);
    if (references > 0) {
      throw AppError.conflict(
        'media.still_in_use',
        `This image is still used by ${references} experience${
          references === 1 ? '' : 's'
        }. Remove it from those first.`,
      );
    }

    // The row goes first. A missing file behind a live row is a broken image on
    // a card; an orphaned file behind no row is wasted bytes that the sweep
    // will find. Only one of those is visible to a user.
    await this.assets.delete(id);

    const paths = [asset.originalPath, ...asset.variants.map((variant) => variant.path)];
    for (const path of paths) {
      await this.storage.delete(path).catch((error: unknown) => {
        this.logger.warn(
          `orphaned ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      });
    }
  }
}

export interface ServedFile {
  readonly bytes: Buffer;
  readonly contentType: string;
}

@Injectable()
export class ServeMediaUseCase {
  constructor(@Inject(MEDIA_STORAGE) private readonly storage: MediaStorage) {}

  /**
   * Serves a stored file.
   *
   * This exists so the app works with nothing in front of it — development,
   * and the first deploy before nginx is configured. **In production nginx
   * serves these bytes directly** and this route is never reached: Node has no
   * business being in the path of an image, and a static file served by nginx
   * costs a fraction of the memory and CPU.
   */
  async execute(path: string): Promise<ServedFile> {
    const bytes = await this.storage.read(path);
    if (!bytes) {
      throw AppError.notFound('media.file_not_found', 'No such file.');
    }
    return {
      bytes,
      contentType: path.endsWith('.webp') ? VARIANT_CONTENT_TYPE : 'application/octet-stream',
    };
  }
}

@Injectable()
export class GetMediaUseCase {
  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(id: string): Promise<{ asset: MediaAsset; ref: MediaRefProjection }> {
    const asset = await this.assets.findById(id);
    if (!asset) {
      throw AppError.notFound('media.not_found', 'No such image.');
    }
    return { asset, ref: toMediaRef(asset, this.config.mediaBaseUrl) };
  }
}
