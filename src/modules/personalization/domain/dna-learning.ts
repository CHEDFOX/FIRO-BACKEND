import { Tag } from '../../catalog/domain/taxonomy';
import {
  Dimension,
  DnaVector,
  EMPTY_DIMENSION,
  ExplorerDna,
  dimensionOf,
  learningRate,
} from './explorer-dna';
import { SignalKind } from './signal';
import { transferWeight } from './tag-affinity';

/**
 * The learning rules. Pure functions over (dna, observation) -> dna, so the
 * whole model is unit-testable without a database, a queue, or a framework.
 */

/** Evidence half-life. Taste from a year ago should not outrank last month. */
export const HALF_LIFE_DAYS = 180;
const MS_PER_DAY = 86_400_000;

/**
 * Old evidence fades. This keeps the profile feeling like *who you are now*
 * and stops an early burst of activity permanently defining someone.
 */
export function decayFactor(fromIso: string, toMs: number): number {
  const fromMs = Date.parse(fromIso);
  if (!Number.isFinite(fromMs) || toMs <= fromMs) {
    return 1;
  }
  const elapsedDays = (toMs - fromMs) / MS_PER_DAY;
  return 0.5 ** (elapsedDays / HALF_LIFE_DAYS);
}

function decayed(dimension: Dimension, nowMs: number): Dimension {
  const factor = decayFactor(dimension.updatedAt, nowMs);
  if (factor === 1) {
    return dimension;
  }
  return {
    positive: dimension.positive * factor,
    negative: dimension.negative * factor,
    exposures: dimension.exposures * factor,
    updatedAt: dimension.updatedAt,
  };
}

export interface Observation {
  readonly kind: SignalKind;
  /** Tags of the experience the user acted on. */
  readonly tags: readonly Tag[];
  /** Signed evidence weight (see weightOf in signal.ts). */
  readonly weight: number;
  readonly at: string;
}

/**
 * Exposure normalisation.
 *
 * If we show 100 mountain photos the user will interact with mountains — that
 * is *our* bias, not their taste. Dividing interest by how much we actually
 * showed them prevents the feed becoming a self-fulfilling loop. Damped with a
 * +1 so a first-ever exposure does not produce an extreme value.
 */
export function exposureNormalised(weight: number, exposures: number): number {
  if (weight <= 0) {
    return weight;
  }
  return weight * (1 / Math.sqrt(1 + exposures / 10));
}

/**
 * Credit assignment across an experience's tags.
 *
 * We observe a reaction to a *place*, not to a tag. Someone rejecting Gion
 * almost certainly disliked one thing about it — not culture AND food AND
 * architecture AND history AND nightlife equally. Spreading the full weight
 * onto every tag makes one tap produce a fistful of strong opinions, which is
 * both wrong and hard to recover from. Dividing by sqrt(n) keeps a multi-tag
 * experience informative while stopping any single tap from over-committing.
 */
export function tagDilution(tagCount: number): number {
  return tagCount <= 1 ? 1 : 1 / Math.sqrt(tagCount);
}

/**
 * Fold one observation into a profile.
 *
 * Applied per tag on the experience, so a single save teaches us about all ~6
 * of its dimensions at once, then transfers a damped share onto correlated
 * tags the user may never have been shown.
 */
export function applyObservation(
  dna: ExplorerDna,
  observation: Observation,
  nowMs: number = Date.parse(observation.at),
): ExplorerDna {
  const nowIso = new Date(nowMs).toISOString();
  const dimensions: DnaVector = { ...dna.dimensions };

  // Every tag that should move: the direct ones, plus correlated neighbours.
  const affected = new Map<Tag, number>();
  for (const tag of observation.tags) {
    affected.set(tag, 1);
  }
  for (const tag of observation.tags) {
    for (const other of Object.values(Tag)) {
      if (affected.get(other) === 1) {
        continue; // a direct hit always wins over a transfer
      }
      const transfer = transferWeight(tag, other);
      if (transfer !== 0) {
        // Keep the strongest transfer if several source tags reach the same one.
        const existing = affected.get(other) ?? 0;
        if (Math.abs(transfer) > Math.abs(existing)) {
          affected.set(other, transfer);
        }
      }
    }
  }

  for (const [tag, share] of affected) {
    const current = decayed(dimensions[tag] ?? EMPTY_DIMENSION, nowMs);

    if (observation.kind === SignalKind.IMPRESSION) {
      // Being shown something is not evidence of taste — only of our choices.
      // Record it so future interactions can be normalised against it.
      if (share === 1) {
        dimensions[tag] = {
          ...current,
          exposures: current.exposures + 1,
          updatedAt: nowIso,
        };
      }
      continue;
    }

    const rate = learningRate(current);
    const dilution = tagDilution(observation.tags.length);
    const raw = observation.weight * share * rate * dilution;
    const adjusted = exposureNormalised(raw, current.exposures);

    dimensions[tag] = {
      positive: current.positive + Math.max(0, adjusted),
      negative: current.negative + Math.max(0, -adjusted),
      exposures: current.exposures,
      updatedAt: nowIso,
    };
  }

  return {
    ...dna,
    dimensions,
    signalCount: dna.signalCount + 1,
    updatedAt: nowIso,
    version: dna.version + 1,
  };
}

/**
 * Seed a new profile from the population average so a day-one user starts
 * somewhere sane rather than blank — they then only need enough evidence to
 * move *away* from average, which is far less than learning from scratch.
 */
export function seedFromPrior(
  dna: ExplorerDna,
  prior: ReadonlyMap<Tag, number>,
  strength: number,
  now: string,
): ExplorerDna {
  const dimensions: DnaVector = { ...dna.dimensions };
  for (const [tag, score] of prior) {
    const current = dimensionOf(dna, tag);
    const evidence = Math.abs(score) * strength;
    dimensions[tag] = {
      positive: current.positive + (score > 0 ? evidence : 0),
      negative: current.negative + (score < 0 ? evidence : 0),
      exposures: current.exposures,
      updatedAt: now,
    };
  }
  return { ...dna, dimensions, updatedAt: now, version: dna.version + 1 };
}
