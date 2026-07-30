/**
 * The shared vocabulary between the catalog and Explorer DNA.
 *
 * These tags are the SAME dimensions the personalization module scores, which
 * is what lets us match "this user loves cold, quiet places" to "this place is
 * cold and solitary" without a machine-learning model on day one. Keep this
 * list stable — it is a contract, not a free-form label set.
 */
export const Tag = {
  ADVENTURE: 'adventure',
  LUXURY: 'luxury',
  CULTURE: 'culture',
  NATURE: 'nature',
  PHOTOGRAPHY: 'photography',
  FOOD: 'food',
  HIKING: 'hiking',
  ROAD_TRIP: 'road_trip',
  NIGHTLIFE: 'nightlife',
  WILDLIFE: 'wildlife',
  ARCHITECTURE: 'architecture',
  HISTORY: 'history',
  CAMPING: 'camping',
  MINIMALISM: 'minimalism',
  COLD: 'cold',
  WARM: 'warm',
  WATER: 'water',
  MOUNTAINS: 'mountains',
  DESERT: 'desert',
  SOLITUDE: 'solitude',
  SOCIAL: 'social',
  BEACH: 'beach',
  ISLAND: 'island',
  CITY: 'city',
} as const;

export type Tag = (typeof Tag)[keyof typeof Tag];

export const ALL_TAGS: readonly Tag[] = Object.values(Tag);

export function isTag(value: unknown): value is Tag {
  return typeof value === 'string' && (ALL_TAGS as readonly string[]).includes(value);
}

/** Rough cost band, used for budget-aware filtering. */
export const BudgetBand = {
  BUDGET: 'budget',
  MODERATE: 'moderate',
  PREMIUM: 'premium',
  LUXURY: 'luxury',
} as const;

export type BudgetBand = (typeof BudgetBand)[keyof typeof BudgetBand];

export const BUDGET_BAND_ORDER: readonly BudgetBand[] = [
  BudgetBand.BUDGET,
  BudgetBand.MODERATE,
  BudgetBand.PREMIUM,
  BudgetBand.LUXURY,
];

/** Months (1-12) encoded as a bitmask, so "best season" is a cheap integer test. */
export type SeasonMask = number;

export const ALL_MONTHS: SeasonMask = 0b1111_1111_1111;

export function seasonMaskFromMonths(months: readonly number[]): SeasonMask {
  return months.reduce<number>((mask, month) => {
    if (month < 1 || month > 12) {
      return mask;
    }
    return mask | (1 << (month - 1));
  }, 0);
}

export function isInSeason(mask: SeasonMask, month: number): boolean {
  if (month < 1 || month > 12) {
    return false;
  }
  return (mask & (1 << (month - 1))) !== 0;
}
