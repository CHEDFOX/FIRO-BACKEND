import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_REPOSITORY, CatalogRepository } from '../../catalog/domain/catalog.repository';
import { ALL_TAGS } from '../../catalog/domain/taxonomy';
import { ListSavedUseCase } from '../../discovery/application/list-saved.usecase';
import { DNA_REPOSITORY, DnaRepository } from '../domain/dna.repository';
import { emptyDna, tagConfidence } from '../domain/explorer-dna';
import { ScoredExperience } from '../domain/scorer';
import { SCORER, Scorer } from '../domain/scorer';
import { buildFeed } from '../domain/feed-builder';
import {
  SESSION_INTENT_REPOSITORY,
  SessionIntentRepository,
  decayIntent,
} from '../domain/session-intent';

export interface BuildFeedQuery {
  readonly userId: string;
  readonly sessionId?: string;
  readonly limit: number;
  /** Overridable for testing; defaults to the current month. */
  readonly month?: number;
}

/** How many candidates to score before ranking trims to the feed length. */
const CANDIDATE_MULTIPLIER = 6;
const MIN_CANDIDATES = 60;

/**
 * The personalised feed: candidates -> scoring -> diversity/wildcard ordering.
 *
 * The funnel shape is what matters here. Each stage is replaceable — a smarter
 * candidate source, a learned scorer — without changing the others or the API.
 */
@Injectable()
export class BuildFeedUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(DNA_REPOSITORY) private readonly dnaRepo: DnaRepository,
    @Inject(SESSION_INTENT_REPOSITORY) private readonly intents: SessionIntentRepository,
    @Inject(SCORER) private readonly scorer: Scorer,
    private readonly listSaved: ListSavedUseCase,
  ) {}

  async execute(query: BuildFeedQuery): Promise<ScoredExperience[]> {
    const now = new Date();
    const month = query.month ?? now.getMonth() + 1;

    const dna =
      (await this.dnaRepo.find(query.userId)) ?? emptyDna(query.userId, now.toISOString());

    const intent = query.sessionId
      ? await this.intents
          .find(query.userId, query.sessionId)
          .then((found) => (found ? decayIntent(found, now.getTime()) : null))
      : null;

    const savedIds = await this.listSaved.savedIds(query.userId);

    // Candidate generation: a broad pool, deliberately larger than the feed so
    // ranking and diversity have room to work.
    const candidates = await this.catalog.listExperiences({
      limit: Math.max(MIN_CANDIDATES, query.limit * CANDIDATE_MULTIPLIER),
    });

    // Do not re-sell what someone has already taken.
    const fresh = candidates.filter((experience) => !savedIds.has(experience.id));

    const scored = this.scorer.score(fresh, { dna, intent, month, savedIds });

    const profileConfidence =
      ALL_TAGS.reduce((sum, tag) => sum + tagConfidence(dna, tag), 0) / ALL_TAGS.length;

    return buildFeed(scored, {
      limit: query.limit,
      profileConfidence,
      seed: dna.version,
    });
  }
}
