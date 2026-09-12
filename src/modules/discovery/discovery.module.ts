import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MapController } from '../catalog/infrastructure/http/map.controller';
import { IdentityModule } from '../identity/identity.module';
import { ListSavedUseCase } from './application/list-saved.usecase';
import { SaveExperienceUseCase } from './application/save-experience.usecase';
import { UnsaveExperienceUseCase } from './application/unsave-experience.usecase';
import { COLLECTION_ITEM_REPOSITORY, COLLECTION_REPOSITORY } from './domain/collection';
import { SavesController } from './infrastructure/http/saves.controller';
import { repositoryProvider } from '../../infrastructure/database/repository-provider';
import {
  InMemoryCollectionItemRepository,
  InMemoryCollectionRepository,
} from './infrastructure/persistence/in-memory-collection.repository';
import {
  PostgresCollectionItemRepository,
  PostgresCollectionRepository,
} from './infrastructure/persistence/postgres-collection.repository';

/**
 * Discovery bounded context: collections and saves today; search and the
 * composed feed land here next.
 *
 * MapController is registered here (rather than in CatalogModule) because the
 * map's "show only my saved places" mode needs ListSavedUseCase — keeping the
 * dependency one-directional, Discovery -> Catalog.
 */
@Module({
  imports: [IdentityModule, CatalogModule],
  controllers: [SavesController, MapController],
  providers: [
    InMemoryCollectionRepository,
    InMemoryCollectionItemRepository,
    PostgresCollectionRepository,
    PostgresCollectionItemRepository,
    repositoryProvider(
      COLLECTION_REPOSITORY,
      PostgresCollectionRepository,
      InMemoryCollectionRepository,
    ),
    repositoryProvider(
      COLLECTION_ITEM_REPOSITORY,
      PostgresCollectionItemRepository,
      InMemoryCollectionItemRepository,
    ),
    SaveExperienceUseCase,
    UnsaveExperienceUseCase,
    ListSavedUseCase,
  ],
  exports: [ListSavedUseCase, COLLECTION_ITEM_REPOSITORY],
})
export class DiscoveryModule {}
