import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../infrastructure/database/repository-provider';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DeleteMediaUseCase,
  GetMediaUseCase,
  ListMediaUseCase,
  ServeMediaUseCase,
} from './application/media.usecases';
import { UploadImageUseCase } from './application/upload-image.usecase';
import { IMAGE_PROCESSOR } from './domain/image-processor';
import { MEDIA_ASSET_REPOSITORY } from './domain/media-asset.repository';
import { MEDIA_STORAGE } from './domain/media-storage';
import { AdminMediaController, MediaFileController } from './infrastructure/http/media.controller';
import { SharpImageProcessor } from './infrastructure/image/sharp-image-processor';
import { InMemoryMediaAssetRepository } from './infrastructure/persistence/in-memory-media-asset.repository';
import { PostgresMediaAssetRepository } from './infrastructure/persistence/postgres-media-asset.repository';
import { LocalMediaStorage } from './infrastructure/storage/local-media-storage';

/**
 * Media: the photographs the product is built on.
 *
 * Storage is the VPS's own disk behind the MEDIA_STORAGE port, served by nginx
 * in production. That is a deliberate choice, not an assumption — see
 * ADR-0011. Moving to object storage later replaces one adapter.
 */
@Module({
  imports: [IdentityModule, CatalogModule],
  controllers: [AdminMediaController, MediaFileController],
  providers: [
    { provide: MEDIA_STORAGE, useClass: LocalMediaStorage },
    { provide: IMAGE_PROCESSOR, useClass: SharpImageProcessor },
    InMemoryMediaAssetRepository,
    PostgresMediaAssetRepository,
    repositoryProvider(
      MEDIA_ASSET_REPOSITORY,
      PostgresMediaAssetRepository,
      InMemoryMediaAssetRepository,
    ),
    UploadImageUseCase,
    ListMediaUseCase,
    GetMediaUseCase,
    DeleteMediaUseCase,
    ServeMediaUseCase,
  ],
  exports: [MEDIA_ASSET_REPOSITORY, MEDIA_STORAGE],
})
export class MediaModule {}
