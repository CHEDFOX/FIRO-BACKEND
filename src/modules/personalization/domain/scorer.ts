import { Experience } from '../../catalog/domain/experience';
import { ExplorerDna } from './explorer-dna';
import { SessionIntent } from './session-intent';
import { TasteMatch, matchTags } from './taste-match';

/**
 * The ranking seam.
 *
 * Everything downstream depends on this interface, never on the maths behind
 * it, so a learned model can replace the heuristic later without touching a
 * single caller. That is the whole point of defining it now.
 */

export interface ScoringContext {
  readonly dna: ExplorerDna;
  readonly intent: SessionIntent | null;
  /** 1-12, for season fit. */
  readonly month: number;
  /** Already-saved ids, so we do not re-sell what someone has taken. */
  readonly savedIds: ReadonlySet<string>;
}

export interface ScoredExperience {
  readonly experience: Experience;
  readonly score: number;
  readonly match: TasteMatch;
  /** Human-readable "because you…" line, when we are confident enough. */
  readonly reason: string | null;
  /** True when picked to surprise rather than to match — the wildcard. */
  readonly isWildcard: boolean;
}

export interface Scorer {
  score(experiences: readonly Experience[], context: ScoringContext): ScoredExperience[];
}

export const SCORER = Symbol('SCORER');

/** Relative pull of each ingredient in the blend. */
export const WEIGHTS = {
  taste: 1.0,
  wow: 0.35,
  season: 0.25,
  novelty: 0.2,
} as const;

/**
 * Heuristic scorer: transparent, tunable, and good enough to launch.
 *
 * Deliberately not machine learning — with no users there is nothing to train
 * on, and an interpretable model lets us explain recommendations and debug them
 * by reading the numbers.
 */
export class HeuristicScorer implements Scorer {
  score(experiences: readonly Experience[], context: ScoringContext): ScoredExperience[] {
    return experiences.map((experience) => {
      const match = matchTags(context.dna, experience.tags, context.intent);

      const seasonFit = isInMonth(experience.seasonMask, context.month) ? 1 : 0;
      const novelty = experience.hiddenGemScore;

      const score =
        WEIGHTS.taste * match.score +
        WEIGHTS.wow * experience.wowScore +
        WEIGHTS.season * seasonFit +
        WEIGHTS.novelty * novelty;

      return {
        experience,
        score,
        match,
        reason: null, // attached by the feed builder, which knows the surface
        isWildcard: false,
      };
    });
  }
}

function isInMonth(mask: number, month: number): boolean {
  return (mask & (1 << (month - 1))) !== 0;
}
