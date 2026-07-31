import { ALL_TAGS, Tag } from '../../catalog/domain/taxonomy';

/**
 * Explorer DNA — an interpretable taste profile.
 *
 * Each taste dimension keeps POSITIVE and NEGATIVE evidence separately rather
 * than a single blended number. Everything else (score, confidence, cold-start
 * behaviour, learning rate) falls out of those two numbers, which is what makes
 * the model both fast-learning and stable:
 *
 *   score      = (pos - neg) / (pos + neg + SHRINKAGE)   ->  -1 .. +1
 *   confidence = (pos + neg) / (pos + neg + SHRINKAGE)   ->   0 .. 1
 *
 * With thin evidence SHRINKAGE pulls the score toward neutral, so one stray tap
 * cannot swing the profile; as evidence accumulates its influence fades and the
 * score sharpens. This is deliberately explainable — we can show a user *why*
 * something was recommended, which an opaque embedding cannot do.
 */

/**
 * Prior strength. Higher = more conservative, slower to commit.
 * Tuned so a single save lands near 0.5 (a clear lean, not a conviction) and
 * roughly six consistent signals reach high confidence.
 */
export const SHRINKAGE = 6;

export interface Dimension {
  /** Accumulated positive evidence (decayed). */
  readonly positive: number;
  /** Accumulated negative evidence (decayed). */
  readonly negative: number;
  /** How many times the user was *shown* something with this tag. */
  readonly exposures: number;
  readonly updatedAt: string;
}

export type DnaVector = Partial<Record<Tag, Dimension>>;

export interface ExplorerDna {
  readonly userId: string;
  readonly dimensions: DnaVector;
  /** Total signals folded in — drives the "profile completeness" feel. */
  readonly signalCount: number;
  readonly updatedAt: string;
  readonly version: number;
}

export const EMPTY_DIMENSION: Dimension = {
  positive: 0,
  negative: 0,
  exposures: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function emptyDna(userId: string, now: string): ExplorerDna {
  return { userId, dimensions: {}, signalCount: 0, updatedAt: now, version: 0 };
}

export function dimensionOf(dna: ExplorerDna, tag: Tag): Dimension {
  return dna.dimensions[tag] ?? EMPTY_DIMENSION;
}

/** Affinity in -1..+1. 0 means "no opinion". */
export function scoreOf(dimension: Dimension): number {
  const total = dimension.positive + dimension.negative;
  if (total === 0) {
    return 0;
  }
  return (dimension.positive - dimension.negative) / (total + SHRINKAGE);
}

/** 0..1 — how much evidence stands behind the score. */
export function confidenceOf(dimension: Dimension): number {
  const total = dimension.positive + dimension.negative;
  return total / (total + SHRINKAGE);
}

export function tagScore(dna: ExplorerDna, tag: Tag): number {
  return scoreOf(dimensionOf(dna, tag));
}

export function tagConfidence(dna: ExplorerDna, tag: Tag): number {
  return confidenceOf(dimensionOf(dna, tag));
}

/**
 * Learning rate for the next signal on a dimension: large while we know little,
 * small once we are confident. Fast convergence without later whiplash.
 *
 * Capped at 2x: a bigger boost combined with a heavy signal (a save is worth 3)
 * makes the profile far too certain after a single tap.
 */
export function learningRate(dimension: Dimension): number {
  return 1 + (1 - confidenceOf(dimension));
}

export interface TasteSummary {
  readonly tag: Tag;
  readonly score: number;
  readonly confidence: number;
}

/** The strongest positive tastes, for "because you love…" explanations. */
export function topTastes(dna: ExplorerDna, limit = 5, minConfidence = 0.25): TasteSummary[] {
  return ALL_TAGS.map((tag) => ({
    tag,
    score: tagScore(dna, tag),
    confidence: tagConfidence(dna, tag),
  }))
    .filter((entry) => entry.score > 0.05 && entry.confidence >= minConfidence)
    .sort((a, b) => b.score * b.confidence - a.score * a.confidence)
    .slice(0, limit);
}

/** Tastes the user has actively rejected — used as soft filters. */
export function dislikes(dna: ExplorerDna, minConfidence = 0.25): TasteSummary[] {
  return ALL_TAGS.map((tag) => ({
    tag,
    score: tagScore(dna, tag),
    confidence: tagConfidence(dna, tag),
  }))
    .filter((entry) => entry.score < -0.15 && entry.confidence >= minConfidence)
    .sort((a, b) => a.score - b.score);
}

/**
 * Overall profile completeness (0..1) — the "your Explorer DNA is 64% complete"
 * number. Deliberately based on how many dimensions we have real confidence in,
 * not on raw signal volume, so it reflects genuine knowledge.
 */
export function completeness(dna: ExplorerDna): number {
  const known = ALL_TAGS.reduce((sum, tag) => sum + tagConfidence(dna, tag), 0);
  return Math.min(1, known / ALL_TAGS.length);
}
