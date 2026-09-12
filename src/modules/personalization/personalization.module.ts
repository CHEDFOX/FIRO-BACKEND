import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IdentityModule } from '../identity/identity.module';
import { BuildFeedUseCase } from './application/build-feed.usecase';
import { GetDnaUseCase } from './application/get-dna.usecase';
import { RecordSignalUseCase } from './application/record-signal.usecase';
import { SubmitOnboardingUseCase } from './application/submit-onboarding.usecase';
import { DNA_REPOSITORY } from './domain/dna.repository';
import { HeuristicScorer, SCORER } from './domain/scorer';
import { SESSION_INTENT_REPOSITORY } from './domain/session-intent';
import { SIGNAL_REPOSITORY } from './domain/signal';
import { OnboardingController } from './infrastructure/http/onboarding.controller';
import { PersonalizationController } from './infrastructure/http/personalization.controller';
import {
  InMemoryDnaRepository,
  InMemorySessionIntentRepository,
  InMemorySignalRepository,
} from './infrastructure/persistence/in-memory-personalization.repository';

/**
 * Personalization bounded context: Explorer DNA and the recommendation funnel.
 *
 * The SCORER binding is the seam that lets a learned ranker replace the
 * heuristic later without touching the feed, the API, or the client.
 */
@Module({
  imports: [IdentityModule, CatalogModule, DiscoveryModule],
  controllers: [PersonalizationController, OnboardingController],
  providers: [
    { provide: DNA_REPOSITORY, useClass: InMemoryDnaRepository },
    { provide: SIGNAL_REPOSITORY, useClass: InMemorySignalRepository },
    { provide: SESSION_INTENT_REPOSITORY, useClass: InMemorySessionIntentRepository },
    { provide: SCORER, useClass: HeuristicScorer },
    RecordSignalUseCase,
    BuildFeedUseCase,
    GetDnaUseCase,
    SubmitOnboardingUseCase,
  ],
  exports: [GetDnaUseCase, DNA_REPOSITORY],
})
export class PersonalizationModule {}
