import { Tag } from '../../catalog/domain/taxonomy';

/**
 * Taste transfer between tags.
 *
 * Tastes correlate: people drawn to `cold` tend to be drawn to `solitude` and
 * `mountains`. By letting a signal on one tag partially transfer to its
 * neighbours, one interaction teaches us about dimensions the user has never
 * even been shown — which is the difference between *learning* and merely
 * counting. This is the single cheapest way to learn fast from sparse data.
 *
 * Seeded by hand here (symmetric, deliberately conservative). Once real
 * behaviour exists these weights should be *learned* from co-occurrence in
 * saves; the shape of this table stays the same, so that upgrade is a data
 * change, not a code change.
 */

type Pair = readonly [Tag, Tag, number];

const CORRELATIONS: readonly Pair[] = [
  // The quiet, cold, wild cluster
  [Tag.COLD, Tag.SOLITUDE, 0.45],
  [Tag.COLD, Tag.MOUNTAINS, 0.4],
  [Tag.COLD, Tag.MINIMALISM, 0.3],
  [Tag.SOLITUDE, Tag.NATURE, 0.4],
  [Tag.SOLITUDE, Tag.MINIMALISM, 0.35],
  [Tag.MOUNTAINS, Tag.HIKING, 0.6],
  [Tag.MOUNTAINS, Tag.NATURE, 0.5],
  [Tag.HIKING, Tag.ADVENTURE, 0.55],
  [Tag.HIKING, Tag.CAMPING, 0.45],
  [Tag.CAMPING, Tag.ADVENTURE, 0.4],
  [Tag.CAMPING, Tag.NATURE, 0.4],
  [Tag.WILDLIFE, Tag.NATURE, 0.55],
  [Tag.WILDLIFE, Tag.ADVENTURE, 0.3],

  // The warm, social, coastal cluster
  [Tag.WARM, Tag.BEACH, 0.5],
  [Tag.BEACH, Tag.WATER, 0.6],
  [Tag.BEACH, Tag.ISLAND, 0.5],
  [Tag.ISLAND, Tag.WATER, 0.45],
  [Tag.WARM, Tag.SOCIAL, 0.2],
  [Tag.SOCIAL, Tag.NIGHTLIFE, 0.55],
  [Tag.NIGHTLIFE, Tag.CITY, 0.5],
  [Tag.SOCIAL, Tag.FOOD, 0.35],

  // The cultural / urban cluster
  [Tag.CULTURE, Tag.HISTORY, 0.6],
  [Tag.CULTURE, Tag.ARCHITECTURE, 0.5],
  [Tag.HISTORY, Tag.ARCHITECTURE, 0.5],
  [Tag.CITY, Tag.ARCHITECTURE, 0.45],
  [Tag.CITY, Tag.FOOD, 0.4],
  [Tag.CULTURE, Tag.FOOD, 0.35],
  [Tag.LUXURY, Tag.CITY, 0.25],

  // Cross-cutting
  [Tag.PHOTOGRAPHY, Tag.NATURE, 0.3],
  [Tag.PHOTOGRAPHY, Tag.ARCHITECTURE, 0.25],
  [Tag.ROAD_TRIP, Tag.ADVENTURE, 0.4],
  [Tag.ROAD_TRIP, Tag.NATURE, 0.3],
  [Tag.DESERT, Tag.WARM, 0.4],
  [Tag.DESERT, Tag.SOLITUDE, 0.4],
  [Tag.DESERT, Tag.MINIMALISM, 0.35],
  [Tag.ADVENTURE, Tag.NATURE, 0.3],

  // Genuine opposites — evidence for one is weak evidence against the other.
  [Tag.SOLITUDE, Tag.SOCIAL, -0.5],
  [Tag.SOLITUDE, Tag.NIGHTLIFE, -0.35],
  [Tag.COLD, Tag.WARM, -0.45],
  [Tag.LUXURY, Tag.CAMPING, -0.4],
  [Tag.MINIMALISM, Tag.LUXURY, -0.3],
  [Tag.CITY, Tag.NATURE, -0.25],
];

/** tag -> (neighbour -> transfer weight), built once and reused. */
const MATRIX: Map<Tag, Map<Tag, number>> = (() => {
  const matrix = new Map<Tag, Map<Tag, number>>();
  const link = (a: Tag, b: Tag, weight: number): void => {
    const row = matrix.get(a) ?? new Map<Tag, number>();
    row.set(b, weight);
    matrix.set(a, row);
  };
  for (const [a, b, weight] of CORRELATIONS) {
    link(a, b, weight);
    link(b, a, weight); // correlation is symmetric
  }
  return matrix;
})();

/**
 * Neighbours that should receive a fraction of a signal aimed at `tag`.
 * Transfer is damped so related tags never learn as fast as the direct one.
 */
export const TRANSFER_DAMPING = 0.35;

export function relatedTags(tag: Tag): ReadonlyMap<Tag, number> {
  return MATRIX.get(tag) ?? new Map<Tag, number>();
}

/** The damped transfer weight from a direct signal on `from` onto `to`. */
export function transferWeight(from: Tag, to: Tag): number {
  if (from === to) {
    return 1;
  }
  const correlation = MATRIX.get(from)?.get(to) ?? 0;
  return correlation * TRANSFER_DAMPING;
}
