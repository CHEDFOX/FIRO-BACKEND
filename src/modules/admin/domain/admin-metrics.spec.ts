import type { ExplorerDna } from '../../personalization/domain/explorer-dna';
import {
  bucketByDay,
  daysAgo,
  denseDailySeries,
  populationTaste,
  profileCompleteness,
  strongestTags,
  utcDay,
} from './admin-metrics';

function dna(userId: string, dimensions: Record<string, [number, number]>): ExplorerDna {
  return {
    userId,
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([tag, [positive, negative]]) => [
        tag,
        {
          positive,
          negative,
          exposures: positive + negative,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ),
    signalCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  } as ExplorerDna;
}

describe('admin metrics', () => {
  const now = new Date('2026-03-10T12:34:56.000Z');

  describe('denseDailySeries', () => {
    it('emits one point per day, oldest first, ending today', () => {
      const series = denseDailySeries(new Map(), now, 5);
      expect(series).toHaveLength(5);
      expect(series[0]?.day).toBe('2026-03-06');
      expect(series[4]?.day).toBe('2026-03-10');
    });

    // A chart that simply omits quiet days reads as "no data" rather than
    // "no signups", which is the opposite conclusion.
    it('fills days with no activity with a zero instead of dropping them', () => {
      const series = denseDailySeries(new Map([['2026-03-08', 4]]), now, 5);
      expect(series.map((point) => point.count)).toEqual([0, 0, 4, 0, 0]);
    });

    it('ignores counts outside the window', () => {
      const series = denseDailySeries(new Map([['2025-01-01', 99]]), now, 3);
      expect(series.every((point) => point.count === 0)).toBe(true);
    });
  });

  describe('bucketByDay', () => {
    it('groups ISO timestamps into UTC days', () => {
      const buckets = bucketByDay([
        '2026-03-09T23:59:59.000Z',
        '2026-03-10T00:00:01.000Z',
        '2026-03-10T09:00:00.000Z',
      ]);
      expect(buckets.get('2026-03-09')).toBe(1);
      expect(buckets.get('2026-03-10')).toBe(2);
    });
  });

  describe('populationTaste', () => {
    it('averages over the profiles that hold an opinion, not over everyone', () => {
      // One enthusiast, two people who have never encountered the tag. The tag
      // should read as strongly liked-but-niche, not as weak.
      const profiles = [dna('a', { desert: [10, 0] }), dna('b', { city: [4, 0] }), dna('c', {})];
      const desert = populationTaste(profiles).find((row) => row.tag === 'desert');
      expect(desert?.profiles).toBe(1);
      expect(desert?.net).toBeGreaterThan(0.5);
    });

    it('leaves out tags nobody has an opinion about', () => {
      const rows = populationTaste([dna('a', { cold: [3, 0] })]);
      expect(rows.map((row) => row.tag)).toEqual(['cold']);
    });

    it('surfaces strong dislikes, not just likes', () => {
      const rows = populationTaste([dna('a', { nightlife: [0, 12] })]);
      expect(rows[0]?.net).toBeLessThan(0);
    });
  });

  describe('strongestTags', () => {
    it('ranks by score weighted by confidence, so a single tap does not top the list', () => {
      const profile = dna('a', { mountains: [12, 0], luxury: [1, 0] });
      expect(strongestTags(profile)[0]).toBe('mountains');
    });

    it('is empty for a user we know nothing about', () => {
      expect(strongestTags(null)).toEqual([]);
      expect(strongestTags(dna('a', {}))).toEqual([]);
    });

    it('excludes disliked tags', () => {
      expect(strongestTags(dna('a', { nightlife: [0, 8] }))).toEqual([]);
    });
  });

  describe('profileCompleteness', () => {
    it('is 0 without a profile and rises with evidence', () => {
      expect(profileCompleteness(null)).toBe(0);
      const thin = profileCompleteness(dna('a', { cold: [1, 0] }));
      const thick = profileCompleteness(dna('a', { cold: [40, 0], warm: [30, 0] }));
      expect(thin).toBeGreaterThan(0);
      expect(thick).toBeGreaterThan(thin);
      expect(thick).toBeLessThanOrEqual(1);
    });
  });

  describe('utcDay / daysAgo', () => {
    it('formats and subtracts in UTC', () => {
      expect(utcDay(now)).toBe('2026-03-10');
      expect(daysAgo(now, 7)).toBe('2026-03-03T12:34:56.000Z');
    });
  });
});
