import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../../../shared/ids';
import { CATALOG_REPOSITORY, CatalogRepository } from '../../catalog/domain/catalog.repository';
import { DNA_REPOSITORY, DnaRepository } from '../domain/dna.repository';
import { applyObservation, seedFromPrior } from '../domain/dna-learning';
import { ExplorerDna, emptyDna } from '../domain/explorer-dna';
import {
  SESSION_INTENT_REPOSITORY,
  SessionIntentRepository,
  applyIntent,
  emptyIntent,
} from '../domain/session-intent';
import {
  SIGNAL_REPOSITORY,
  Signal,
  SignalKind,
  SignalRepository,
  weightOf,
} from '../domain/signal';

export interface RecordSignalCommand {
  readonly userId: string;
  readonly sessionId?: string;
  readonly kind: SignalKind;
  readonly experienceId: string;
  readonly durationMs?: number;
}

/** How much evidence the population prior is worth when seeding a new profile. */
const PRIOR_STRENGTH = 1.5;

/**
 * Records one behavioural signal and folds it into the user's taste.
 *
 * Kept deliberately cheap and failure-tolerant: personalisation must never be
 * the reason a screen is slow or a save fails. In production the fold moves to
 * the worker behind a queue; the interface here does not change.
 */
@Injectable()
export class RecordSignalUseCase {
  constructor(
    @Inject(SIGNAL_REPOSITORY) private readonly signals: SignalRepository,
    @Inject(DNA_REPOSITORY) private readonly dnaRepo: DnaRepository,
    @Inject(SESSION_INTENT_REPOSITORY) private readonly intents: SessionIntentRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  async execute(command: RecordSignalCommand): Promise<{ recorded: boolean }> {
    const experience = await this.catalog.findExperienceById(command.experienceId);
    if (!experience) {
      // Never fail a client interaction over an unknown id; just ignore it.
      return { recorded: false };
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const signal: Signal = {
      id: uuidv7(nowMs),
      userId: command.userId,
      sessionId: command.sessionId ?? null,
      kind: command.kind,
      experienceId: experience.id,
      durationMs: command.durationMs ?? null,
      occurredAt: nowIso,
    };
    await this.signals.append(signal);

    const weight = weightOf(signal);

    const dna = await this.loadOrSeed(command.userId, nowIso);
    const updated = applyObservation(
      dna,
      { kind: signal.kind, tags: experience.tags, weight, at: nowIso },
      nowMs,
    );
    await this.dnaRepo.save(updated);

    // Session intent reacts immediately; impressions do not shape intent.
    if (command.sessionId && signal.kind !== SignalKind.IMPRESSION && weight !== 0) {
      const existing =
        (await this.intents.find(command.userId, command.sessionId)) ??
        emptyIntent(command.userId, command.sessionId, nowIso);
      await this.intents.save(applyIntent(existing, experience.tags, weight, nowMs));
    }

    return { recorded: true };
  }

  /** New users start at the population average, not blank. */
  private async loadOrSeed(userId: string, now: string): Promise<ExplorerDna> {
    const existing = await this.dnaRepo.find(userId);
    if (existing) {
      return existing;
    }
    const prior = await this.dnaRepo.populationPrior();
    const fresh = emptyDna(userId, now);
    return prior.size > 0 ? seedFromPrior(fresh, prior, PRIOR_STRENGTH, now) : fresh;
  }
}
