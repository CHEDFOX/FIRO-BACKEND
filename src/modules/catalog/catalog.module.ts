import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BrowseExperiencesUseCase } from './application/browse-experiences.usecase';
import { GetExperienceUseCase } from './application/get-experience.usecase';
import { MapViewUseCase } from './application/map-view.usecase';
import { CATALOG_REPOSITORY } from './domain/catalog.repository';
import { CATALOG_WRITER } from './domain/catalog-writer';
import { CatalogController } from './infrastructure/http/catalog.controller';
import { MapController } from './infrastructure/http/map.controller';
import { repositoryProvider } from '../../infrastructure/database/repository-provider';
import { InMemoryCatalogRepository } from './infrastructure/persistence/in-memory-catalog.repository';
import { InMemoryCatalogWriter } from './infrastructure/persistence/in-memory-catalog-writer.repository';
import { PostgresCatalogRepository } from './infrastructure/persistence/postgres-catalog.repository';
import { PostgresCatalogWriter } from './infrastructure/persistence/postgres-catalog-writer.repository';

/**
 * Catalog bounded context: the geo hierarchy (country > region > place), the
 * experiences that are the atom of discovery, and the map viewport query.
 *
 * Exports CATALOG_REPOSITORY so Discovery can resolve saved experiences without
 * reaching into this module's internals.
 *
 * NOTE: MapController depends on Discovery's ListSavedUseCase; that provider is
 * supplied by DiscoveryModule, which imports this one. To avoid a circular
 * module graph the map route lives here but is registered in DiscoveryModule.
 */
@Module({
  imports: [IdentityModule],
  controllers: [CatalogController],
  providers: [
    InMemoryCatalogRepository,
    PostgresCatalogRepository,
    repositoryProvider(CATALOG_REPOSITORY, PostgresCatalogRepository, InMemoryCatalogRepository),
    InMemoryCatalogWriter,
    PostgresCatalogWriter,
    repositoryProvider(CATALOG_WRITER, PostgresCatalogWriter, InMemoryCatalogWriter),
    BrowseExperiencesUseCase,
    GetExperienceUseCase,
    MapViewUseCase,
  ],
  exports: [CATALOG_REPOSITORY, CATALOG_WRITER, MapViewUseCase, InMemoryCatalogRepository],
})
export class CatalogModule {}

export { MapController };
