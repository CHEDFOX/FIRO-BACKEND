import { ALL_TAGS, Tag } from '../../catalog/domain/taxonomy';
import {
  confidenceOf,
  EMPTY_DIMENSION,
  ExplorerDna,
  scoreOf,
} from '../../personalization/domain/explorer-dna';
import type { DayCount, TagPopularity } from './admin-queries';

/**
 * Pure shaping functions for the dashboard.
 *
 * They live in the domain layer (not in an adapter) because both the Postgres
 * and in-memory read models need the exact same answers — a chart that
 * disappears on days with no activity, or a differently-rounded completeness
 * number, would make the two modes disagree about what the data means.
 */

export const TREND_DAYS = 30;

/** YYYY-MM-DD in UTC. */
export function utcDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

/**
 * Turns sparse counts into a dense, oldest-first series ending today.
 *
 * Without this a quiet Tuesday simply vanishes from the chart, which reads as
 * "no data" rather than "no signups" — the opposite conclusion.
 */
export function denseDailySeries(
  counts: ReadonlyMap<string, number>,
  now: Date,
  days = TREND_DAYS,
): DayCount[] {
  const series: DayCount[] = [];
  const end = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = utcDay(new Date(end - offset * 86_400_000));
    series.push({ day, count: counts.get(day) ?? 0 });
  }
  return series;
}

/** Counts ISO timestamps into UTC day buckets. */
export function bucketByDay(timestamps: readonly string[]): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const timestamp of timestamps) {
    const day = utcDay(timestamp);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return buckets;
}

/**
 * What the whole population likes, as a tuning aid.
 *
 * Averaged over the profiles that hold an opinion on the tag, not over all
 * profiles: dividing by the total would make a tag that 3 people love and
 * nobody else has ever seen look weak rather than niche.
 */
export function populationTaste(profiles: readonly ExplorerDna[], limit = 12): TagPopularity[] {
  const rows: TagPopularity[] = [];
  for (const tag of ALL_TAGS) {
    let net = 0;
    let holders = 0;
    for (const profile of profiles) {
      const dimension = profile.dimensions[tag];
      if (!dimension || dimension.positive + dimension.negative === 0) {
        continue;
      }
      net += scoreOf(dimension);
      holders += 1;
    }
    if (holders > 0) {
      rows.push({ tag, net: round(net / holders), profiles: holders });
    }
  }
  return rows
    .sort((a, b) => Math.abs(b.net) * b.profiles - Math.abs(a.net) * a.profiles)
    .slice(0, limit);
}

/** The tags this profile leans towards, strongest first. */
export function strongestTags(dna: ExplorerDna | null, limit = 4): Tag[] {
  if (!dna) {
    return [];
  }
  return ALL_TAGS.map((tag) => {
    const dimension = dna.dimensions[tag] ?? EMPTY_DIMENSION;
    return { tag, weight: scoreOf(dimension) * confidenceOf(dimension) };
  })
    .filter((entry) => entry.weight > 0.02)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((entry) => entry.tag);
}

/** Mirrors ExplorerDna.completeness, rounded for display. */
export function profileCompleteness(dna: ExplorerDna | null): number {
  if (!dna) {
    return 0;
  }
  const known = ALL_TAGS.reduce(
    (sum, tag) => sum + confidenceOf(dna.dimensions[tag] ?? EMPTY_DIMENSION),
    0,
  );
  return round(Math.min(1, known / ALL_TAGS.length));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** ISO timestamp `days` before `now`. Used for every "last N days" window. */
export function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
