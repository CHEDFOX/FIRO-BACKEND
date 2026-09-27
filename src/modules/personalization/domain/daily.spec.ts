import { Tag, describeSeason, seasonMaskFromMonths } from '../../catalog/domain/taxonomy';
import type { Experience } from '../../catalog/domain/experience';
import {
  addDays,
  choosePick,
  dailyReason,
  greetingFor,
  localDay,
  monthInsight,
  sketchOf,
  timeOfDay,
  worldSummary,
} from './daily';
import type { ExplorerDna } from './explorer-dna';
import type { ScoredExperience } from './scorer';

function experience(id: string, tags: Tag[], lat = 60): Experience {
  return {
    id,
    placeId: 'plc',
    slug: id,
    title: id,
    summary: '',
    story: null,
    coordinates: { lat, lng: 10 },
    tags,
    budgetBand: 'moderate',
    seasonMask: 4095,
    difficulty: 1,
    wowScore: 0.5,
    hiddenGemScore: 0.5,
    media: [],
    status: 'published',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function scored(id: string, tags: Tag[], isWildcard = false): ScoredExperience {
  return {
    experience: experience(id, tags),
    score: 1,
    match: {} as ScoredExperience['match'],
    reason: null,
    isWildcard,
  };
}

function dna(evidence: Partial<Record<Tag, [number, number]>>): ExplorerDna {
  return {
    userId: 'u',
    dimensions: Object.fromEntries(
      Object.entries(evidence).map(([tag, [positive, negative]]) => [
        tag,
        { positive, negative, exposures: positive + negative, updatedAt: '2026-01-01T00:00:00Z' },
      ]),
    ),
    signalCount: 10,
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
  };
}

describe('the daily ritual', () => {
  describe('time', () => {
    // 23:30 UTC on the 27th is already the 28th in Oslo and still the 27th in
    // Los Angeles. "Today" has to be the user's.
    it("uses the user's local calendar day, not the server's", () => {
      const now = new Date('2026-09-27T23:30:00Z');
      expect(localDay(now, 'Europe/Oslo')).toBe('2026-09-28');
      expect(localDay(now, 'America/Los_Angeles')).toBe('2026-09-27');
      expect(localDay(now, 'UTC')).toBe('2026-09-27');
    });

    it('names the part of the day the app should soften into', () => {
      expect(timeOfDay(6)).toBe('morning');
      expect(timeOfDay(13)).toBe('day');
      expect(timeOfDay(19)).toBe('evening');
      expect(timeOfDay(23)).toBe('night');
      expect(timeOfDay(3)).toBe('night');
    });

    it('adds days across month and year ends', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });
  });

  describe('greetingFor', () => {
    it('speaks the two strongest feelings, climate first', () => {
      expect(greetingFor([Tag.MOUNTAINS, Tag.SOLITUDE, Tag.COLD])).toBe(
        'Somewhere cold and quiet, today.',
      );
    });

    it('is the same whatever order the tags were stored in', () => {
      expect(greetingFor([Tag.SOLITUDE, Tag.COLD])).toBe(greetingFor([Tag.COLD, Tag.SOLITUDE]));
    });

    it('falls back to a phrase when no tag is an adjective', () => {
      expect(greetingFor([Tag.WATER, Tag.PHOTOGRAPHY])).toBe('Somewhere by the water, today.');
    });

    it('never says a filter out loud', () => {
      expect(greetingFor([Tag.ARCHITECTURE])).toBe('Somewhere new, today.');
    });
  });

  describe('dailyReason', () => {
    const likesColdQuiet = dna({ cold: [9, 0], solitude: [8, 0], water: [4, 0] });

    it('names what the place shares with what the user has actually chosen', () => {
      const reason = dailyReason([Tag.COLD, Tag.SOLITUDE, Tag.WATER], likesColdQuiet, {
        isWildcard: false,
        asked: false,
        toward: null,
      });
      expect(reason).toBe('chosen because you keep choosing cold, quiet places by the water');
    });

    // The one visible trace of the engine must never claim a pattern the
    // profile cannot back.
    it('admits a guess when the profile has nothing to say', () => {
      const reason = dailyReason([Tag.DESERT], dna({}), {
        isWildcard: false,
        asked: false,
        toward: null,
      });
      expect(reason).toContain('first guess');
    });

    it('keeps the promise when the user asked for somewhere warm', () => {
      expect(
        dailyReason([Tag.WARM], likesColdQuiet, {
          isWildcard: true,
          asked: true,
          toward: Tag.WARM,
        }),
      ).toBe('somewhere warm, as you asked');
    });

    it('owns an unrequested surprise', () => {
      expect(
        dailyReason([Tag.CITY], likesColdQuiet, { isWildcard: true, asked: false, toward: null }),
      ).toBe('something outside your usual, on purpose');
    });
  });

  describe('choosePick', () => {
    const ranked = [
      scored('fjord', [Tag.COLD]),
      scored('glacier', [Tag.COLD]),
      scored('beach', [Tag.WARM, Tag.BEACH]),
      scored('market', [Tag.CITY], true),
    ];
    const none = { surprise: false, toward: null };

    it('takes the best match', () => {
      expect(choosePick(ranked, [], none)?.item.experience.id).toBe('fjord');
    });

    // A daily ritual that shows yesterday again reads as broken.
    it('never repeats a recent day', () => {
      const pick = choosePick(ranked, [{ experienceId: 'fjord', day: '2026-09-26' }], none);
      expect(pick?.item.experience.id).toBe('glacier');
    });

    it('honours a directed surprise before anything else', () => {
      const pick = choosePick(ranked, [], { surprise: true, toward: Tag.WARM });
      expect(pick?.item.experience.id).toBe('beach');
      expect(pick?.isWildcard).toBe(true);
      expect(pick?.usedSurprise).toBe(true);
    });

    it("takes the engine's wildcard for a plain surprise", () => {
      const pick = choosePick(ranked, [], { surprise: true, toward: null });
      expect(pick?.item.experience.id).toBe('market');
    });

    it('repeats the one seen longest ago once everything has been shown', () => {
      const recent = [
        { experienceId: 'fjord', day: '2026-09-20' },
        { experienceId: 'glacier', day: '2026-09-24' },
        { experienceId: 'beach', day: '2026-09-25' },
        { experienceId: 'market', day: '2026-09-26' },
      ];
      expect(choosePick(ranked, recent, none)?.item.experience.id).toBe('fjord');
    });

    it('returns nothing only when there is nothing', () => {
      expect(choosePick([], [], none)).toBeNull();
    });
  });

  describe('monthInsight', () => {
    it('waits for enough days before claiming a pattern', () => {
      expect(monthInsight([{ tags: [Tag.COLD], lat: 68, kept: true }])).toBe(
        'A few more days, and a pattern will start to show.',
      );
    });

    it('says where the month leaned and what was passed over', () => {
      const days = [
        { tags: [Tag.COLD, Tag.SOLITUDE], lat: 68, kept: true },
        { tags: [Tag.COLD], lat: 64, kept: true },
        { tags: [Tag.WARM], lat: 37, kept: false },
        { tags: [Tag.WARM, Tag.DESERT], lat: 31, kept: false },
        { tags: [Tag.COLD], lat: 67, kept: false },
      ];
      expect(monthInsight(days)).toBe(
        'You lean north. Two days this month were warm, and you kept none of them.',
      );
    });

    it('notices what was always kept', () => {
      const days = [
        { tags: [Tag.MOUNTAINS], lat: 46, kept: true },
        { tags: [Tag.MOUNTAINS], lat: 47, kept: true },
        { tags: [Tag.CITY], lat: 35, kept: true },
        { tags: [Tag.CITY, Tag.MOUNTAINS], lat: 35, kept: true },
      ];
      expect(monthInsight(days)).toContain('You kept every high place you were shown.');
    });
  });

  describe('worldSummary', () => {
    it('is kind about an empty map', () => {
      const summary = worldSummary([]);
      expect(summary.headline).toBe('Nothing kept yet.');
      expect(summary.question).toBeNull();
    });

    it('speaks the shape of the map and asks one question about tomorrow', () => {
      const summary = worldSummary([
        { tags: [Tag.COLD, Tag.SOLITUDE], lat: 68, countryCode: 'NO' },
        { tags: [Tag.COLD], lat: 64, countryCode: 'IS' },
        { tags: [Tag.COLD, Tag.MOUNTAINS], lat: 46, countryCode: 'IT' },
      ]);
      expect(summary.headline).toBe('Mostly north, mostly cold.');
      expect(summary.detail).toBe('3 kept · 3 countries');
      expect(summary.question).toBe(
        "You've never kept anywhere below 40°. Shall tomorrow be somewhere warm?",
      );
      // The question is only honest if "yes" can steer tomorrow that way.
      expect(summary.surpriseToward).toBe(Tag.WARM);
    });

    it('offers the opposite of a strong habit when geography says nothing', () => {
      const summary = worldSummary([
        { tags: [Tag.CITY], lat: 35, countryCode: 'JP' },
        { tags: [Tag.CITY], lat: -13, countryCode: 'PE' },
        { tags: [Tag.CITY], lat: 37, countryCode: 'PT' },
      ]);
      expect(summary.question).toBe(
        "Every place you've kept is busy. Shall tomorrow be somewhere green?",
      );
      expect(summary.surpriseToward).toBe(Tag.NATURE);
    });
  });

  describe('describeSeason', () => {
    it('keeps a winter that wraps the new year whole', () => {
      expect(describeSeason(seasonMaskFromMonths([12, 1, 2]))).toBe('December to February');
    });

    it('names single months, whole years and split seasons', () => {
      expect(describeSeason(seasonMaskFromMonths([6]))).toBe('June');
      expect(describeSeason(4095)).toBe('All year');
      expect(describeSeason(seasonMaskFromMonths([4, 5, 9, 10]))).toBe(
        'April to May, and September to October',
      );
      expect(describeSeason(0)).toBeNull();
    });
  });

  describe('sketchOf', () => {
    it('speaks a new profile as a few words, strongest first', () => {
      expect(sketchOf([Tag.COLD, Tag.SOLITUDE, Tag.MOUNTAINS, Tag.WATER])).toEqual([
        'Cold.',
        'Quiet.',
        'Mountains.',
        'and some water.',
      ]);
    });

    it('stops at four and never repeats a word', () => {
      const sketch = sketchOf([Tag.SOCIAL, Tag.NIGHTLIFE, Tag.CITY, Tag.FOOD, Tag.CULTURE]);
      expect(sketch).toHaveLength(4);
      expect(new Set(sketch).size).toBe(4);
    });

    it('says one word plainly, and nothing when there is nothing', () => {
      expect(sketchOf([Tag.DESERT])).toEqual(['Deserts.']);
      expect(sketchOf([])).toEqual([]);
    });
  });
});
