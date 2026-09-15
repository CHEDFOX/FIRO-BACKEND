import { Module } from '@nestjs/common';
import { repositoryProvider } from '../../infrastructure/database/repository-provider';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IdentityModule } from '../identity/identity.module';
import { PersonalizationModule } from '../personalization/personalization.module';
import {
  DeleteExperienceUseCase,
  SetUserRolesUseCase,
  SetUserStatusUseCase,
} from './application/moderate.usecases';
import {
  GetActivityUseCase,
  GetAdminMapUseCase,
  GetOverviewUseCase,
  GetUserDetailUseCase,
  ListAuditLogUseCase,
  ListContentUseCase,
  ListPlacesUseCase,
  ListUsersUseCase,
} from './application/read-dashboard.usecases';
import { ResolveActor } from './application/resolve-actor';
import { UpsertExperienceUseCase } from './application/upsert-experience.usecase';
import { ADMIN_QUERIES } from './domain/admin-queries';
import { AUDIT_LOG } from './domain/audit-log';
import { AdminController } from './infrastructure/http/admin.controller';
import {
  InMemoryAuditLog,
  PostgresAuditLog,
} from './infrastructure/persistence/audit-log.repository';
import { InMemoryAdminQueries } from './infrastructure/persistence/in-memory-admin.queries';
import { PostgresAdminQueries } from './infrastructure/persistence/postgres-admin.queries';

/**
 * The private operator console.
 *
 * It sits *above* the bounded contexts rather than beside them: it reads across
 * all of them through its own read model (see the AdminQueries port) and writes
 * only through the ports the owning modules expose. Nothing in the product
 * depends on this module, so removing it would change no user-facing behaviour
 * — which is the test of whether the boundary held.
 *
 * It must be imported last in AppModule so its dependencies are already built.
 */
@Module({
  imports: [IdentityModule, CatalogModule, DiscoveryModule, PersonalizationModule],
  controllers: [AdminController],
  providers: [
    InMemoryAdminQueries,
    PostgresAdminQueries,
    repositoryProvider(ADMIN_QUERIES, PostgresAdminQueries, InMemoryAdminQueries),
    InMemoryAuditLog,
    PostgresAuditLog,
    repositoryProvider(AUDIT_LOG, PostgresAuditLog, InMemoryAuditLog),
    GetOverviewUseCase,
    ListUsersUseCase,
    GetUserDetailUseCase,
    ListContentUseCase,
    ListPlacesUseCase,
    GetAdminMapUseCase,
    GetActivityUseCase,
    ListAuditLogUseCase,
    UpsertExperienceUseCase,
    DeleteExperienceUseCase,
    SetUserStatusUseCase,
    SetUserRolesUseCase,
    ResolveActor,
  ],
})
export class AdminModule {}
