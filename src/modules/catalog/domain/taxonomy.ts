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

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The months (1-12) set in a season mask, in calendar order. */
export function monthsInSeason(mask: SeasonMask): number[] {
  const months: number[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (isInSeason(mask, month)) {
      months.push(month);
    }
  }
  return months;
}

/**
 * A season mask as a person would say it: "December to February",
 * "June", "All year", "April to May, and September to October".
 *
 * Runs wrap across the new year, because winter does: a mask of Dec+Jan+Feb is
 * one season, not "January to February, and December".
 */
export function describeSeason(mask: SeasonMask): string | null {
  const months = monthsInSeason(mask);
  if (months.length === 0) {
    return null;
  }
  if (months.length === 12) {
    return 'All year';
  }

  // Find contiguous runs on a 12-month circle, starting just after a gap so a
  // run that wraps December into January is kept whole.
  const set = new Set(months);
  let start = 1;
  while (set.has(start)) {
    start = (start % 12) + 1;
  }

  const runs: [number, number][] = [];
  let runStart: number | null = null;
  let previous = 0;
  for (let step = 0; step < 12; step += 1) {
    const month = ((start - 1 + step) % 12) + 1;
    if (set.has(month)) {
      if (runStart === null) {
        runStart = month;
      }
      previous = month;
    } else if (runStart !== null) {
      runs.push([runStart, previous]);
      runStart = null;
    }
  }
  if (runStart !== null) {
    runs.push([runStart, previous]);
  }

  const phrases = runs.map(([from, to]) =>
    from === to ? MONTH_NAMES[from - 1]! : `${MONTH_NAMES[from - 1]} to ${MONTH_NAMES[to - 1]}`,
  );
  if (phrases.length === 1) {
    return phrases[0]!;
  }
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}
