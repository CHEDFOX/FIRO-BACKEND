import { Experience, ExperienceStatus } from '../../catalog/domain/experience';
import { BudgetBand, Tag, seasonMaskFromMonths } from '../../catalog/domain/taxonomy';
import { buildFeed, WILDCARD_EVERY } from './feed-builder';
import { ScoredExperience } from './scorer';

const TS = '2026-01-01T00:00:00.000Z';

function experience(id: string, tags: Tag[], hiddenGem = 0.2, wow = 0.8): Experience {
  return {
    id,
    placeId: `plc_${id}`,
    slug: id,
    title: id,
    summary: '',
    story: null,
    coordinates: { lat: 0, lng: 0 },
    tags,
    budgetBand: BudgetBand.MODERATE,
    seasonMask: seasonMaskFromMonths([1]),
    difficulty: 2,
    wowScore: wow,
    hiddenGemScore: hiddenGem,
    media: [],
    status: ExperienceStatus.PUBLISHED,
    createdAt: TS,
    updatedAt: TS,
  };
}

function scored(
  id: string,
  tags: Tag[],
  score: number,
  confidence = 0.8,
  hiddenGem = 0.2,
): ScoredExperience {
  return {
    experience: experience(id, tags, hiddenGem),
    score,
    match: { score, confidence, topTag: tags[0] ?? null },
    reason: null,
    isWildcard: false,
  };
}

describe('feed builder', () => {
  it('leads with the strongest match', () => {
    const feed = buildFeed(
      [
        scored('weak', [Tag.CITY], 0.1),
        scored('strong', [Tag.COLD], 0.9),
        scored('mid', [Tag.FOOD], 0.5),
      ],
      { limit: 3, profileConfidence: 0.9, seed: 1 },
    );
    expect(feed[0].experience.id).toBe('strong');
  });

  it('breaks up monotony — does not stack identical tags', () => {
    const items = [
      scored('cold1', [Tag.COLD, Tag.MOUNTAINS], 0.9),
      scored('cold2', [Tag.COLD, Tag.MOUNTAINS], 0.88),
      scored('cold3', [Tag.COLD, Tag.MOUNTAINS], 0.86),
      scored('food1', [Tag.FOOD, Tag.CITY], 0.6),
    ];
    const feed = buildFeed(items, { limit: 4, profileConfidence: 0.9, seed: 1 });
    const firstThree = feed.slice(0, 3).map((entry) => entry.experience.id);
    // The food item should surface early despite a lower raw score, because
    // the repeated cold/mountain tags get penalised.
    expect(firstThree).toContain('food1');
  });

  it('injects a wildcard at the expected cadence', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      scored(`e${i}`, [Tag.COLD], 0.9 - i * 0.01, 0.8, i === 11 ? 0.95 : 0.1),
    );
    const feed = buildFeed(items, { limit: 12, profileConfidence: 0.9, seed: 1 });

    expect(feed[WILDCARD_EVERY].isWildcard).toBe(true);
    expect(feed[0].isWildcard).toBe(false);
    expect(feed.filter((entry) => entry.isWildcard).length).toBeGreaterThan(0);
  });

  it('labels wildcards as a deliberate surprise', () => {
    const items = Array.from({ length: 8 }, (_, i) => scored(`e${i}`, [Tag.COLD], 0.9 - i * 0.05));
    const feed = buildFeed(items, { limit: 8, profileConfidence: 0.9, seed: 1 });
    const wildcard = feed.find((entry) => entry.isWildcard);
    expect(wildcard?.reason).toBe('Something a little different');
  });

  it('explains a confident match in human terms', () => {
    const feed = buildFeed([scored('cold1', [Tag.COLD], 0.8)], {
      limit: 1,
      profileConfidence: 0.9,
      seed: 1,
    });
    expect(feed[0].reason).toBe('Because you love cold, quiet places');
  });

  it('stays quiet rather than guessing when it does not know you', () => {
    const feed = buildFeed([scored('x', [Tag.COLD], 0.01, 0.05)], {
      limit: 1,
      profileConfidence: 0.05,
      seed: 1,
    });
    expect(feed[0].reason).toBeNull();
  });

  it('explores informative items while the profile is thin', () => {
    // Same score; one is about tags we know nothing about.
    const known = scored('known', [Tag.COLD], 0.5, 0.95);
    const unknown = scored('unknown', [Tag.DESERT], 0.5, 0.02);

    const cold = buildFeed([known, unknown], { limit: 2, profileConfidence: 0.0, seed: 1 });
    expect(cold[0].experience.id).toBe('unknown');

    // Once confident, exploration stops driving the order.
    const warm = buildFeed([known, unknown], { limit: 2, profileConfidence: 1, seed: 1 });
    expect(warm[0].experience.id).toBe('known');
  });

  it('never returns more than asked, and handles an empty pool', () => {
    const items = Array.from({ length: 10 }, (_, i) => scored(`e${i}`, [Tag.COLD], 0.5));
    expect(buildFeed(items, { limit: 3, profileConfidence: 0.5, seed: 1 })).toHaveLength(3);
    expect(buildFeed([], { limit: 5, profileConfidence: 0.5, seed: 1 })).toEqual([]);
  });

  it('never repeats an item', () => {
    const items = Array.from({ length: 10 }, (_, i) => scored(`e${i}`, [Tag.COLD], 0.5));
    const feed = buildFeed(items, { limit: 10, profileConfidence: 0.5, seed: 1 });
    expect(new Set(feed.map((entry) => entry.experience.id)).size).toBe(10);
  });
});
