import { Tag } from '../../catalog/domain/taxonomy';
import { ExplorerDna, tagConfidence, tagScore } from './explorer-dna';
import { SessionIntent, blendedScore, intentScore } from './session-intent';

/**
 * Matching a profile against a set of tags, and explaining why.
 */

export interface TasteMatch {
  /** -1..1 — how well this matches the user right now. */
  readonly score: number;
  /** 0..1 — how much evidence stands behind that judgement. */
  readonly confidence: number;
  /** The tag that contributed most, for a human-readable reason. */
  readonly topTag: Tag | null;
}

/**
 * Score an experience's tags against long-term DNA blended with session intent.
 *
 * Each tag contributes its blended score weighted by our confidence in it, so
 * dimensions we genuinely know about dominate ones we are guessing at. The
 * result is confidence-weighted rather than a raw average, which keeps early
 * recommendations sane instead of erratic.
 */
export function matchTags(
  dna: ExplorerDna,
  tags: readonly Tag[],
  intent: SessionIntent | null = null,
): TasteMatch {
  if (tags.length === 0) {
    return { score: 0, confidence: 0, topTag: null };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let bestTag: Tag | null = null;
  let bestContribution = 0;

  for (const tag of tags) {
    const base = tagScore(dna, tag);
    const confidence = tagConfidence(dna, tag);
    const blended = intent ? blendedScore(base, intentScore(intent, tag)) : base;

    // A confidence floor lets intent still steer tags we know nothing about.
    const weight = Math.max(confidence, 0.15);
    weightedSum += blended * weight;
    weightTotal += weight;

    const contribution = blended * weight;
    if (contribution > bestContribution) {
      bestContribution = contribution;
      bestTag = tag;
    }
  }

  const score = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  const confidence = tags.reduce((sum, tag) => sum + tagConfidence(dna, tag), 0) / tags.length;

  return { score, confidence, topTag: bestTag };
}

const TAG_PHRASE: Partial<Record<Tag, string>> = {
  [Tag.COLD]: 'cold, quiet places',
  [Tag.WARM]: 'warm places',
  [Tag.SOLITUDE]: 'places with no one else around',
  [Tag.SOCIAL]: 'places with a bit of life',
  [Tag.MOUNTAINS]: 'mountains',
  [Tag.WATER]: 'water',
  [Tag.BEACH]: 'beaches',
  [Tag.ISLAND]: 'islands',
  [Tag.DESERT]: 'deserts',
  [Tag.HIKING]: 'walking into the landscape',
  [Tag.CAMPING]: 'sleeping outside',
  [Tag.ADVENTURE]: 'a bit of adventure',
  [Tag.NATURE]: 'wild places',
  [Tag.WILDLIFE]: 'wildlife',
  [Tag.PHOTOGRAPHY]: 'places worth photographing',
  [Tag.CULTURE]: 'culture',
  [Tag.HISTORY]: 'history',
  [Tag.ARCHITECTURE]: 'architecture',
  [Tag.CITY]: 'cities',
  [Tag.FOOD]: 'food',
  [Tag.NIGHTLIFE]: 'nights out',
  [Tag.LUXURY]: 'somewhere special',
  [Tag.MINIMALISM]: 'simple, uncluttered places',
  [Tag.ROAD_TRIP]: 'the open road',
};

/**
 * A human reason for a recommendation. Saying *why* makes a good suggestion
 * feel markedly better — and is only possible because the model is
 * interpretable by design.
 */
export function explain(match: TasteMatch): string | null {
  if (!match.topTag || match.score <= 0.05) {
    return null;
  }
  const phrase = TAG_PHRASE[match.topTag];
  return phrase ? `Because you love ${phrase}` : null;
}
