import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { DNA_REPOSITORY, DnaRepository } from '../domain/dna.repository';
import { applyObservation, seedFromPrior } from '../domain/dna-learning';
import { ExplorerDna, emptyDna } from '../domain/explorer-dna';
import { ONBOARDING_FLOW, OnboardingStepType, findOption, findStep } from '../domain/onboarding';
import { SIGNAL_WEIGHT, SignalKind } from '../domain/signal';

export interface OnboardingAnswer {
  readonly stepId: string;
  readonly selectedOptionIds: string[];
}

export interface SubmitOnboardingCommand {
  readonly userId: string;
  readonly answers: OnboardingAnswer[];
}

export interface SubmitOnboardingResult {
  readonly seededTags: number;
  readonly signalsApplied: number;
}

/** Population prior weight when seeding a brand-new profile. */
const PRIOR_STRENGTH = 1.5;

/**
 * Turns onboarding picks into a first taste profile.
 *
 * Onboarding is not stored as answers — it is folded into the same Explorer DNA
 * that behaviour updates, using the same maths. That matters: onboarding gives
 * the profile a *starting shape*, and real behaviour then moves it. There is no
 * second, competing model to keep in sync.
 */
@Injectable()
export class SubmitOnboardingUseCase {
  constructor(@Inject(DNA_REPOSITORY) private readonly dnaRepo: DnaRepository) {}

  async execute(command: SubmitOnboardingCommand): Promise<SubmitOnboardingResult> {
    if (command.answers.length === 0) {
      throw AppError.validation('onboarding.no_answers', 'No onboarding answers were provided');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    let dna = await this.loadOrSeed(command.userId, nowIso);
    let signalsApplied = 0;
    const touched = new Set<string>();

    for (const answer of command.answers) {
      const step = findStep(answer.stepId);
      if (!step) {
        throw AppError.validation('onboarding.unknown_step', 'Unknown onboarding step', {
          stepId: answer.stepId,
        });
      }

      const selected = new Set(answer.selectedOptionIds);
      if (selected.size < step.minSelect) {
        throw AppError.validation(
          'onboarding.too_few_selections',
          `Step "${step.id}" needs at least ${step.minSelect} selection(s)`,
          { stepId: step.id },
        );
      }

      for (const option of step.options) {
        const wasChosen = selected.has(option.id);

        if (!wasChosen && step.type !== OnboardingStepType.EITHER_OR) {
          // Not picking one chip out of many is weak, ambiguous evidence —
          // people simply stop tapping. Only a forced choice tells us that
          // something was genuinely passed over.
          continue;
        }

        const kind = wasChosen ? SignalKind.ONBOARDING_PICK : SignalKind.ONBOARDING_REJECT;
        dna = applyObservation(
          dna,
          {
            kind,
            tags: option.tags,
            weight: SIGNAL_WEIGHT[kind],
            at: nowIso,
          },
          now.getTime(),
        );
        signalsApplied += 1;
        for (const tag of option.tags) {
          touched.add(tag);
        }
      }

      // Validate that every selected id actually belongs to this step.
      for (const optionId of answer.selectedOptionIds) {
        if (!findOption(step, optionId)) {
          throw AppError.validation('onboarding.unknown_option', 'Unknown onboarding option', {
            stepId: step.id,
            optionId,
          });
        }
      }
    }

    await this.dnaRepo.save(dna);
    return { seededTags: touched.size, signalsApplied };
  }

  get flowVersion(): string {
    return ONBOARDING_FLOW.version;
  }

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
