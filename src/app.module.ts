import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './bootstrap/config.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PersonalizationModule } from './modules/personalization/personalization.module';
import { HealthModule } from './platform/health/health.module';
import { MetaModule } from './platform/meta/meta.module';
import { AllExceptionsFilter } from './shared/http/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './shared/http/response-envelope.interceptor';

/**
 * The application composition root for the modular monolith.
 *
 * Bounded contexts (identity, catalog, personalization, discovery, planning,
 * social, commerce) are added here as they are built. Cross-cutting platform
 * concerns (health, meta, and later BDUI, flags, AI gateway) live under
 * platform/. Global filter + interceptor enforce the standard API envelope.
 */
@Module({
  imports: [
    ConfigModule,
    // platform
    HealthModule,
    MetaModule,
    // bounded contexts
    IdentityModule,
    CatalogModule,
    DiscoveryModule,
    PersonalizationModule,
    // added in later phases:
    // PlanningModule, SocialModule, CommerceModule, ...
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
