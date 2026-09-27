import { monthsInSeason, Tag } from '../../catalog/domain/taxonomy';
import { type ExplorerDna, tagScore } from './explorer-dna';
import type { ScoredExperience } from './scorer';

/**
 * One place a day.
 *
 * Firo opens to a single place chosen for the user that morning. Nothing to
 * scroll, nothing to buy. This file holds the decisions and the words behind
 * that ritual, as pure functions, so both are testable and both stay on the
 * server — the client renders what it is given (the BDUI principle), and the
 * app's voice does not fork between platforms.
 */

// ---------------------------------------------------------------- time ------

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

/** Throws on nothing; returns false for anything Intl does not recognise. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The user's local calendar day, YYYY-MM-DD.
 *
 * "Today" is the user's today. A pick made at 23:30 in Oslo belongs to that
 * evening, not to the UTC date, or the ritual would roll over mid-evening for
 * anyone east of Greenwich and mid-afternoon for anyone in the Pacific.
 */
export function localDay(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

/** The app softens with the hour: brighter in the morning, cooler at night. */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 11) {
    return 'morning';
  }
  if (hour >= 11 && hour < 17) {
    return 'day';
  }
  if (hour >= 17 && hour < 22) {
    return 'evening';
  }
  return 'night';
}

/** Adds whole days to a YYYY-MM-DD date, in calendar terms (no DST drift). */
export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- words -----

/**
 * How each taste reads in a sentence.
 *
 * `adjective` fits "somewhere ___"; `phrase` fits after "places". A tag with
 * neither is never spoken — "architecture" is a filter, not a feeling.
 */
const WORDS: Partial<Record<Tag, { adjective?: string; phrase?: string }>> = {
  [Tag.COLD]: { adjective: 'cold' },
  [Tag.WARM]: { adjective: 'warm' },
  [Tag.SOLITUDE]: { adjective: 'quiet' },
  [Tag.SOCIAL]: { adjective: 'lively' },
  [Tag.NIGHTLIFE]: { adjective: 'lively' },
  [Tag.MOUNTAINS]: { adjective: 'high' },
  [Tag.DESERT]: { adjective: 'empty' },
  [Tag.MINIMALISM]: { adjective: 'spare' },
  [Tag.NATURE]: { adjective: 'green' },
  [Tag.WILDLIFE]: { adjective: 'wild' },
  [Tag.HISTORY]: { adjective: 'old' },
  [Tag.CULTURE]: { adjective: 'storied' },
  [Tag.CITY]: { adjective: 'busy' },
  [Tag.LUXURY]: { adjective: 'comfortable' },
  [Tag.ADVENTURE]: { adjective: 'hard-won' },
  [Tag.HIKING]: { adjective: 'hard-won' },
  [Tag.WATER]: { phrase: 'by the water' },
  [Tag.BEACH]: { phrase: 'by the sea' },
  [Tag.ISLAND]: { phrase: 'on an island' },
  [Tag.PHOTOGRAPHY]: { phrase: 'worth photographing' },
  [Tag.CAMPING]: { phrase: 'under the stars' },
  [Tag.ROAD_TRIP]: { phrase: 'at the end of a long road' },
  [Tag.FOOD]: { phrase: 'worth the meal' },
};

/**
 * The order adjectives are spoken in. Climate before mood before terrain reads
 * naturally ("cold and quiet", never "quiet and cold"), and it makes the output
 * deterministic regardless of the order tags were stored in.
 */
const ADJECTIVE_ORDER: readonly Tag[] = [
  Tag.COLD,
  Tag.WARM,
  Tag.SOLITUDE,
  Tag.SOCIAL,
  Tag.NIGHTLIFE,
  Tag.MOUNTAINS,
  Tag.DESERT,
  Tag.NATURE,
  Tag.WILDLIFE,
  Tag.HISTORY,
  Tag.CULTURE,
  Tag.CITY,
  Tag.MINIMALISM,
  Tag.LUXURY,
  Tag.ADVENTURE,
  Tag.HIKING,
];

export function adjectiveFor(tag: Tag): string | null {
  return WORDS[tag]?.adjective ?? null;
}

function orderedAdjectives(tags: readonly Tag[]): string[] {
  const present = new Set(tags);
  const words: string[] = [];
  for (const tag of ADJECTIVE_ORDER) {
    const word = WORDS[tag]?.adjective;
    if (present.has(tag) && word && !words.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

function firstPhrase(tags: readonly Tag[]): string | null {
  for (const tag of tags) {
    const phrase = WORDS[tag]?.phrase;
    if (phrase) {
      return phrase;
    }
  }
  return null;
}

/**
 * The line on the Arrive screen, before the photograph: a hint, not a spoiler.
 *
 *   "Somewhere cold and quiet, today."
 *   "Somewhere by the water, today."
 */
export function greetingFor(tags: readonly Tag[]): string {
  const adjectives = orderedAdjectives(tags).slice(0, 2);
  if (adjectives.length === 2) {
    return `Somewhere ${adjectives[0]} and ${adjectives[1]}, today.`;
  }
  if (adjectives.length === 1) {
    return `Somewhere ${adjectives[0]}, today.`;
  }
  const phrase = firstPhrase(tags);
  return phrase ? `Somewhere ${phrase}, today.` : 'Somewhere new, today.';
}

export interface ClueInput {
  readonly lat: number;
  /** The place's IANA time zone, when the catalogue knows it. */
  readonly timeZone: string | null;
  readonly elevationMeters: number | null;
  readonly seasonMask: number;
  readonly now: Date;
}

/** What the hour feels like there, without claiming weather we do not know. */
function hourAtPlace(hour: number): string {
  if (hour >= 5 && hour < 8) return 'The day is only just beginning.';
  if (hour >= 8 && hour < 12) return 'The morning is still young.';
  if (hour >= 12 && hour < 17) return 'The afternoon is still long.';
  if (hour >= 17 && hour < 21) return 'The day is starting to fade.';
  if (hour >= 21) return 'The evening is settling in.';
  return 'Almost everyone is asleep.';
}

/**
 * Clues, revealed one at a time on the Arrive screen before the place itself.
 *
 *   "It's 06:40 there. The day is only just beginning."
 *   "It lies 64° north, further north than most people ever travel."
 *   "And this is one of the best months to be there."
 *
 * This is the curiosity gap on purpose: enough to picture something, not
 * enough to know it, so the tap that follows is a small act of wanting to
 * know. Every clue is a fact computed from the place, never a flourish: no
 * weather, no crowds, no claim the data cannot back.
 */
export function cluesFor(input: ClueInput): string[] {
  const clues: string[] = [];

  if (input.timeZone && isValidTimeZone(input.timeZone)) {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: input.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(input.now);
    clues.push(
      `It's ${clock} there right now. ${hourAtPlace(localHour(input.now, input.timeZone))}`,
    );
  }

  const lat = Math.round(Math.abs(input.lat));
  if (input.elevationMeters !== null && input.elevationMeters >= 1500) {
    const metres = Math.round(input.elevationMeters / 100) * 100;
    clues.push(
      `It sits ${metres.toLocaleString('en-GB')} metres up, where the air is noticeably thinner.`,
    );
  } else if (input.lat >= 60) {
    clues.push(`It lies ${lat}° north, further north than most people ever travel.`);
  } else if (input.lat <= -46) {
    clues.push(`It lies ${lat}° south, closer to Antarctica than to the equator.`);
  } else if (Math.abs(input.lat) < 23.5) {
    clues.push("It's inside the tropics, where the midday sun stands almost straight overhead.");
  } else if (input.lat < 0) {
    clues.push("It's south of the equator, where the seasons run the other way round.");
  }

  const months = monthsInSeason(input.seasonMask);
  if (months.length > 0 && months.length < 12) {
    const month = input.now.getUTCMonth() + 1;
    clues.push(
      months.includes(month)
        ? 'And this is one of the best months to be there.'
        : "It's out of season there now: the version of it few people ever see.",
    );
  }

  return clues.slice(0, 3);
}

/**
 * The last line of the day, about tomorrow — an open loop.
 *
 * A finished story is easy to put down; an unfinished one is remembered. So
 * the day ends by pointing at the next one, and, when true, by telling the
 * user that what they do today shapes it. Never a promise the pick cannot
 * keep: a surprise that was asked for is named, nothing else is.
 */
export function tomorrowLine(
  rhythm: { surpriseNext: boolean; surpriseToward: Tag | null } | null,
): string {
  if (rhythm?.surpriseNext) {
    const word = rhythm.surpriseToward
      ? (adjectiveFor(rhythm.surpriseToward) ?? firstPhrase([rhythm.surpriseToward]))
      : null;
    return word
      ? `Tomorrow is already decided: somewhere ${word}. That is all you get to know.`
      : 'Tomorrow is already decided, and it is not your usual. That is all you get to know.';
  }
  return "Tomorrow's place hasn't been chosen yet. What you keep today is part of how it will be.";
}

/** Positive-affinity threshold below which a taste is a guess, not a pattern. */
const REASON_MIN_SCORE = 0.1;

/**
 * Why this place, in one line — the only visible trace of the engine.
 *
 * Built from the tags this place shares with what the user has actually
 * leaned towards, so it is never a claim the profile cannot back. When the
 * profile has nothing to say yet, it says so rather than inventing a pattern.
 */
export function dailyReason(
  tags: readonly Tag[],
  dna: ExplorerDna,
  wildcard: { isWildcard: boolean; asked: boolean; toward: Tag | null },
): string {
  if (wildcard.isWildcard) {
    const word = wildcard.toward
      ? (adjectiveFor(wildcard.toward) ?? firstPhrase([wildcard.toward]))
      : null;
    if (wildcard.asked && word) {
      return `somewhere ${word}, as you asked`;
    }
    return wildcard.asked
      ? 'something outside your usual, as you asked'
      : 'something outside your usual, on purpose';
  }

  const liked = tags
    .map((tag) => ({ tag, score: tagScore(dna, tag) }))
    .filter((entry) => entry.score >= REASON_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.tag);

  if (liked.length === 0) {
    return 'chosen as a first guess — keeping it, or not, teaches Firo more';
  }

  const adjectives = orderedAdjectives(liked.slice(0, 3)).slice(0, 2);
  const phrase = firstPhrase(liked.slice(0, 3));
  if (adjectives.length > 0) {
    return `chosen because you keep choosing ${adjectives.join(', ')} places${phrase ? ` ${phrase}` : ''}`;
  }
  return `chosen because you keep choosing places ${phrase ?? 'like this'}`;
}

// ---------------------------------------------------------------- the pick --

export interface RecentPick {
  readonly experienceId: string;
  readonly day: string;
}

export interface PickPreference {
  /** The user asked for tomorrow to surprise them. */
  readonly surprise: boolean;
  /** Optional direction for the surprise, e.g. warm. */
  readonly toward: Tag | null;
}

export interface ChosenPick {
  readonly item: ScoredExperience;
  readonly isWildcard: boolean;
  /** True when the pick honoured a surprise the user asked for. */
  readonly usedSurprise: boolean;
}

/**
 * Chooses today's one place from a ranked list.
 *
 * Rules, in order:
 *  1. Never repeat a recent day. A daily ritual that shows yesterday again
 *     reads as broken, not as a coincidence.
 *  2. If the user asked for a surprise toward something ("somewhere warm"),
 *     honour the direction first — that sentence was a promise.
 *  3. A plain surprise takes the engine's wildcard, or failing that the best of
 *     the lower-ranked half: different, but not something they dislike.
 *  4. Otherwise, the best fresh match.
 *  5. When everything has been shown recently (a small catalogue, a long
 *     habit), repeat the one seen longest ago rather than show nothing.
 */
export function choosePick(
  ranked: readonly ScoredExperience[],
  recent: readonly RecentPick[],
  preference: PickPreference,
): ChosenPick | null {
  if (ranked.length === 0) {
    return null;
  }

  const recentIds = new Set(recent.map((pick) => pick.experienceId));
  const fresh = ranked.filter((item) => !recentIds.has(item.experience.id));

  if (fresh.length > 0) {
    if (preference.surprise && preference.toward) {
      const toward = fresh.find((item) => item.experience.tags.includes(preference.toward!));
      if (toward) {
        return { item: toward, isWildcard: true, usedSurprise: true };
      }
    }
    if (preference.surprise) {
      const wildcard =
        fresh.find((item) => item.isWildcard) ??
        fresh[Math.floor(fresh.length / 2)] ??
        fresh[fresh.length - 1]!;
      return { item: wildcard, isWildcard: true, usedSurprise: true };
    }
    const best = fresh[0]!;
    return { item: best, isWildcard: best.isWildcard, usedSurprise: false };
  }

  // Everything has been shown recently: the one seen longest ago.
  const lastShown = new Map<string, string>();
  for (const pick of recent) {
    const seen = lastShown.get(pick.experienceId);
    if (!seen || pick.day > seen) {
      lastShown.set(pick.experienceId, pick.day);
    }
  }
  const oldest = [...ranked].sort((a, b) =>
    (lastShown.get(a.experience.id) ?? '').localeCompare(lastShown.get(b.experience.id) ?? ''),
  )[0]!;
  return { item: oldest, isWildcard: false, usedSurprise: false };
}

// ---------------------------------------------------------------- reflection

const NUMBER_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
];

function spell(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** Days of a month before its sentence is worth saying. */
const MONTH_PATTERN_DAYS = 4;

export interface ShownDay {
  readonly tags: readonly Tag[];
  readonly lat: number;
  readonly kept: boolean;
}

/**
 * One or two sentences about a month of days, for the quilt.
 *
 *   "You lean north. Four days this month were warm, and you kept none of them."
 *
 * Drawn from what the user was shown and what they kept, so every clause is a
 * fact about their own month. It never scores them and never scolds.
 */
export function monthInsight(days: readonly ShownDay[]): string {
  if (days.length < MONTH_PATTERN_DAYS) {
    // A countdown, not "a few more": a near, named finish line is what makes
    // coming back tomorrow feel like progress (the goal-gradient effect).
    const left = MONTH_PATTERN_DAYS - days.length;
    return `${spell(left)} more ${left === 1 ? 'day' : 'days'}, and this month will start to say something about you — maybe something you didn't notice you were choosing.`;
  }

  const sentences: string[] = [];

  const meanLat = days.reduce((sum, day) => sum + day.lat, 0) / days.length;
  if (meanLat > 42) {
    sentences.push('You lean north.');
  } else if (meanLat < -20) {
    sentences.push('You lean south.');
  } else if (Math.abs(meanLat) < 23.5) {
    sentences.push('You lean toward the warm middle of the world.');
  }

  // Per adjective: how often it was shown, how often it was kept.
  const shown = new Map<string, number>();
  const kept = new Map<string, number>();
  for (const day of days) {
    for (const word of new Set(orderedAdjectives(day.tags))) {
      shown.set(word, (shown.get(word) ?? 0) + 1);
      if (day.kept) {
        kept.set(word, (kept.get(word) ?? 0) + 1);
      }
    }
  }

  const ignored = [...shown.entries()]
    .filter(([word, count]) => count >= 2 && (kept.get(word) ?? 0) === 0)
    .sort((a, b) => b[1] - a[1])[0];
  const loved = [...shown.entries()]
    .filter(([word, count]) => count >= 2 && kept.get(word) === count)
    .sort((a, b) => b[1] - a[1])[0];

  if (ignored) {
    sentences.push(
      `${spell(ignored[1])} days this month were ${ignored[0]}, and you kept none of them.`,
    );
  } else if (loved) {
    sentences.push(`You kept every ${loved[0]} place you were shown.`);
  } else {
    const keptCount = days.filter((day) => day.kept).length;
    sentences.push(
      keptCount === 0
        ? 'You looked, and kept nothing. That is allowed.'
        : `You kept ${spell(keptCount).toLowerCase()} of ${days.length}.`,
    );
  }

  return sentences.join(' ');
}

export interface KeptPlace {
  readonly tags: readonly Tag[];
  readonly lat: number;
  readonly countryCode: string | null;
}

export interface WorldSummary {
  readonly headline: string;
  readonly detail: string;
  /** A question about tomorrow, or null when there is nothing honest to ask. */
  readonly question: string | null;
  /** What "yes" to the question should steer tomorrow toward. */
  readonly surpriseToward: Tag | null;
  /** When there is no question yet: how close the first one is. */
  readonly hint: string | null;
}

/** From this many kept places on, the map always has a question. */
const WORLD_QUESTION_AT = 3;

/** Pairs where leaning hard one way makes the other a real surprise. */
const OPPOSITE: Partial<Record<Tag, Tag>> = {
  [Tag.COLD]: Tag.WARM,
  [Tag.WARM]: Tag.COLD,
  [Tag.SOLITUDE]: Tag.SOCIAL,
  [Tag.SOCIAL]: Tag.SOLITUDE,
  [Tag.CITY]: Tag.NATURE,
  [Tag.NATURE]: Tag.CITY,
  [Tag.MOUNTAINS]: Tag.BEACH,
  [Tag.DESERT]: Tag.WATER,
};

/**
 * The sentences under the user's own map. Speaks, rather than charts.
 *
 *   headline "Mostly north, mostly cold."
 *   question "You've never kept anywhere below 40°. Shall tomorrow be somewhere warm?"
 */
export function worldSummary(kept: readonly KeptPlace[]): WorldSummary {
  if (kept.length === 0) {
    return {
      headline: 'Your map is still dark.',
      detail:
        "Every place you keep becomes a light on it. After a few, the lights start to make a shape, and it isn't always the one you would have drawn yourself.",
      question: null,
      surpriseToward: null,
      hint: null,
    };
  }

  const countries = new Set(kept.map((place) => place.countryCode).filter(Boolean)).size;
  const detail = `${kept.length} kept · ${countries} ${countries === 1 ? 'country' : 'countries'}`;

  const meanLat = kept.reduce((sum, place) => sum + place.lat, 0) / kept.length;
  const direction = meanLat > 35 ? 'Mostly north' : meanLat < -20 ? 'Mostly south' : null;

  // The tag most of the kept places share, if one clearly dominates.
  const counts = new Map<Tag, number>();
  for (const place of kept) {
    for (const tag of new Set(place.tags)) {
      if (adjectiveFor(tag)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  const [dominantTag, dominantCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || ADJECTIVE_ORDER.indexOf(a[0]) - ADJECTIVE_ORDER.indexOf(b[0]),
  )[0] ?? [null, 0];
  const dominant =
    dominantTag && dominantCount / kept.length >= 0.5 ? adjectiveFor(dominantTag) : null;

  // One or two lights are not a pattern yet, and saying "mostly north" about
  // a single place would be a guess dressed as an insight.
  const early = kept.length < WORLD_QUESTION_AT;
  const headline = early
    ? kept.length === 1
      ? 'The first light on your map.'
      : 'Two lights, and the beginning of a shape.'
    : direction && dominant
      ? `${direction}, mostly ${dominant}.`
      : direction
        ? `${direction}.`
        : dominant
          ? `Mostly ${dominant}.`
          : 'A bit of everywhere.';

  const southernmost = Math.min(...kept.map((place) => place.lat));
  if (kept.length >= 2 && southernmost > 40) {
    return {
      headline,
      detail,
      question: "You've never kept anywhere below 40°. Shall tomorrow be somewhere warm?",
      surpriseToward: Tag.WARM,
      hint: null,
    };
  }

  if (dominantTag && dominant && kept.length >= 3 && dominantCount / kept.length >= 0.75) {
    const opposite = OPPOSITE[dominantTag] ?? null;
    const oppositeWord = opposite ? (adjectiveFor(opposite) ?? firstPhrase([opposite])) : null;
    return {
      headline,
      detail,
      question: oppositeWord
        ? `Every place you've kept is ${dominant}. Shall tomorrow be somewhere ${oppositeWord}?`
        : `Every place you've kept is ${dominant}. Shall tomorrow be something else?`,
      surpriseToward: opposite,
      hint: null,
    };
  }

  if (early) {
    const left = WORLD_QUESTION_AT - kept.length;
    return {
      headline,
      detail,
      question: null,
      surpriseToward: null,
      hint: `Keep ${spell(left).toLowerCase()} more ${left === 1 ? 'place' : 'places'}, and your map will have a question for you.`,
    };
  }

  return {
    headline,
    detail,
    question: 'Shall tomorrow surprise you?',
    surpriseToward: null,
    hint: null,
  };
}

// ---------------------------------------------------------------- sketch ----

/**
 * One evocative noun per taste, for the words that appear as a new profile
 * forms. Nouns rather than adjectives because they are spoken on their own
 * ("Mountains."), and each one also reads after "and some …".
 */
const SKETCH: Partial<Record<Tag, string>> = {
  [Tag.COLD]: 'Cold',
  [Tag.WARM]: 'Warmth',
  [Tag.SOLITUDE]: 'Quiet',
  [Tag.SOCIAL]: 'Company',
  [Tag.NIGHTLIFE]: 'Late nights',
  [Tag.MOUNTAINS]: 'Mountains',
  [Tag.DESERT]: 'Deserts',
  [Tag.WATER]: 'Water',
  [Tag.BEACH]: 'Sea air',
  [Tag.ISLAND]: 'Islands',
  [Tag.NATURE]: 'Green places',
  [Tag.WILDLIFE]: 'Wild things',
  [Tag.HISTORY]: 'Old stones',
  [Tag.CULTURE]: 'Stories',
  [Tag.ARCHITECTURE]: 'Fine buildings',
  [Tag.CITY]: 'Cities',
  [Tag.FOOD]: 'Good food',
  [Tag.PHOTOGRAPHY]: 'Light',
  [Tag.HIKING]: 'Long walks',
  [Tag.ADVENTURE]: 'Hard climbs',
  [Tag.CAMPING]: 'Stars',
  [Tag.MINIMALISM]: 'Space',
  [Tag.LUXURY]: 'Comfort',
  [Tag.ROAD_TRIP]: 'Long roads',
};

/**
 * The first sketch of a person, as a few words, strongest first:
 *
 *   ["Cold.", "Quiet.", "Mountains.", "and some water."]
 *
 * Deliberately no percentage. "27% complete" on the first screen after
 * onboarding reads as a test score; a handful of words reads as being seen.
 */
export function sketchOf(tagsStrongestFirst: readonly Tag[]): string[] {
  const nouns: string[] = [];
  for (const tag of tagsStrongestFirst) {
    const noun = SKETCH[tag];
    if (noun && !nouns.includes(noun)) {
      nouns.push(noun);
    }
    if (nouns.length === 4) {
      break;
    }
  }
  if (nouns.length <= 1) {
    return nouns.length === 1 ? [`${nouns[0]}.`] : [];
  }
  const head = nouns.slice(0, -1).map((noun) => `${noun}.`);
  return [...head, `and some ${nouns[nouns.length - 1]!.toLowerCase()}.`];
}
