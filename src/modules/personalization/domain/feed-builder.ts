import { Tag } from '../../catalog/domain/taxonomy';
import { ScoredExperience } from './scorer';
import { explain } from './taste-match';

/**
 * Turning a ranked list into a feed worth scrolling.
 *
 * Pure relevance ranking produces a boring, monotonous feed and, over time, a
 * filter bubble. Three rules fix that:
 *
 *  1. DIVERSITY   — penalise tags already used higher up the feed.
 *  2. WILDCARDS   — deliberately inject a few high-quality surprises just
 *                   outside the user's known taste. Unpredictable delight is
 *                   what keeps a thumb moving; a perfectly predictable feed is
 *                   a boring one.
 *  3. EXPLORATION — while confidence is low, favour *informative* items over
 *                   safe ones, so the feed doubles as an efficient experiment
 *                   and the profile converges in a handful of taps.
 */

/** Score penalty per already-seen tag, applied multiplicatively. */
export const DIVERSITY_PENALTY = 0.15;

/** Roughly one surprise in every six cards. */
export const WILDCARD_EVERY = 6;

export interface FeedOptions {
  readonly limit: number;
  /** 0..1 — overall profile confidence; drives how much we explore. */
  readonly profileConfidence: number;
  /** Deterministic seed so a refresh is stable within a session. */
  readonly seed: number;
}

/**
 * How informative an item would be: highest when we have *no* opinion about
 * its tags. Early on this is what makes learning fast — we ask the questions
 * whose answers we do not already know.
 */
export function informationGain(item: ScoredExperience): number {
  return 1 - item.match.confidence;
}

function diversityAdjusted(item: ScoredExperience, usedTags: Map<Tag, number>): number {
  const overlap = item.experience.tags.reduce((sum, tag) => sum + (usedTags.get(tag) ?? 0), 0);
  return item.score * (1 - Math.min(0.75, DIVERSITY_PENALTY * overlap));
}

function noteTags(item: ScoredExperience, usedTags: Map<Tag, number>): void {
  for (const tag of item.experience.tags) {
    usedTags.set(tag, (usedTags.get(tag) ?? 0) + 1);
  }
}

/**
 * Build the final feed order.
 *
 * Greedy selection: at each slot pick the best *remaining* item under the
 * current diversity penalty, except at wildcard slots where we pick a
 * high-quality item the user would not otherwise have seen.
 */
export function buildFeed(
  scored: readonly ScoredExperience[],
  options: FeedOptions,
): ScoredExperience[] {
  const pool = [...scored];
  const usedTags = new Map<Tag, number>();
  const feed: ScoredExperience[] = [];

  // While we know little about someone, weight informative items higher.
  const explorationBias = Math.max(0, 1 - options.profileConfidence);

  let position = 0;
  while (pool.length > 0 && feed.length < options.limit) {
    const isWildcardSlot = position > 0 && position % WILDCARD_EVERY === 0;

    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < pool.length; i += 1) {
      const item = pool[i];
      const base = diversityAdjusted(item, usedTags);
      const value = isWildcardSlot
        ? // Surprise slot: reward novelty and quality, ignore taste fit.
          item.experience.hiddenGemScore * 1.2 +
          item.experience.wowScore -
          Math.max(0, item.match.score)
        : base + explorationBias * 0.4 * informationGain(item);

      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    const [chosen] = pool.splice(bestIndex, 1);
    noteTags(chosen, usedTags);
    feed.push({
      ...chosen,
      isWildcard: isWildcardSlot,
      reason: isWildcardSlot ? 'Something a little different' : explain(chosen.match),
    });
    position += 1;
  }

  return feed;
}
