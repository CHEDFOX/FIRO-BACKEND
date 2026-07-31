import { Tag } from '../../catalog/domain/taxonomy';
import { applyObservation, decayFactor, exposureNormalised, seedFromPrior } from './dna-learning';
import {
  completeness,
  emptyDna,
  ExplorerDna,
  tagConfidence,
  tagScore,
  topTastes,
} from './explorer-dna';
import { SignalKind, SIGNAL_WEIGHT } from './signal';

const T0 = '2026-01-01T00:00:00.000Z';

function observe(
  dna: ExplorerDna,
  kind: SignalKind,
  tags: Tag[],
  at = T0,
  weight = SIGNAL_WEIGHT[kind],
): ExplorerDna {
  return applyObservation(dna, { kind, tags, weight, at }, Date.parse(at));
}

describe('Explorer DNA learning', () => {
  it('starts with no opinion about anything', () => {
    const dna = emptyDna('u1', T0);
    expect(tagScore(dna, Tag.COLD)).toBe(0);
    expect(tagConfidence(dna, Tag.COLD)).toBe(0);
    expect(completeness(dna)).toBe(0);
  });

  it('learns a positive taste from a save', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.SAVE, [Tag.COLD, Tag.MOUNTAINS]);
    expect(tagScore(dna, Tag.COLD)).toBeGreaterThan(0);
    expect(tagScore(dna, Tag.MOUNTAINS)).toBeGreaterThan(0);
    expect(tagConfidence(dna, Tag.COLD)).toBeGreaterThan(0);
  });

  it('learns a negative taste from an explicit rejection', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.NOT_FOR_ME, [Tag.NIGHTLIFE]);
    expect(tagScore(dna, Tag.NIGHTLIFE)).toBeLessThan(0);
  });

  it('teaches correlated tags the user was never shown (transfer)', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.SAVE, [Tag.COLD]);
    // `solitude` correlates with `cold` and should have moved without ever
    // appearing on the saved experience.
    expect(tagScore(dna, Tag.SOLITUDE)).toBeGreaterThan(0);
    // ...but always less than the tag we actually observed.
    expect(tagScore(dna, Tag.SOLITUDE)).toBeLessThan(tagScore(dna, Tag.COLD));
  });

  it('learns the negative side of an opposite tag', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.SAVE, [Tag.SOLITUDE]);
    expect(tagScore(dna, Tag.SOCIAL)).toBeLessThan(0);
  });

  it('does not swing wildly on a single signal (shrinkage)', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.SAVE, [Tag.COLD]);
    // One save is evidence, not certainty.
    expect(tagScore(dna, Tag.COLD)).toBeLessThan(0.6);
    expect(tagConfidence(dna, Tag.COLD)).toBeLessThan(0.7);
  });

  it('converges: repeated evidence raises both score and confidence', () => {
    let dna = emptyDna('u1', T0);
    const scores: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      dna = observe(dna, SignalKind.SAVE, [Tag.COLD]);
      scores.push(tagScore(dna, Tag.COLD));
    }
    // Monotonically increasing, and meaningfully confident by the end.
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
    expect(tagConfidence(dna, Tag.COLD)).toBeGreaterThan(0.8);
  });

  it('slows down as it becomes confident (asymmetric learning rate)', () => {
    let dna = emptyDna('u1', T0);
    dna = observe(dna, SignalKind.SAVE, [Tag.FOOD]);
    const firstJump = tagScore(dna, Tag.FOOD);

    for (let i = 0; i < 8; i += 1) {
      dna = observe(dna, SignalKind.SAVE, [Tag.FOOD]);
    }
    const before = tagScore(dna, Tag.FOOD);
    dna = observe(dna, SignalKind.SAVE, [Tag.FOOD]);
    const lateJump = tagScore(dna, Tag.FOOD) - before;

    expect(lateJump).toBeLessThan(firstJump);
  });

  it('can change its mind when the evidence reverses', () => {
    let dna = emptyDna('u1', T0);
    for (let i = 0; i < 3; i += 1) {
      dna = observe(dna, SignalKind.SAVE, [Tag.LUXURY]);
    }
    expect(tagScore(dna, Tag.LUXURY)).toBeGreaterThan(0);

    for (let i = 0; i < 6; i += 1) {
      dna = observe(dna, SignalKind.NOT_FOR_ME, [Tag.LUXURY]);
    }
    expect(tagScore(dna, Tag.LUXURY)).toBeLessThan(0);
  });

  it('treats an impression as exposure, never as taste', () => {
    const dna = observe(emptyDna('u1', T0), SignalKind.IMPRESSION, [Tag.BEACH]);
    expect(tagScore(dna, Tag.BEACH)).toBe(0);
    expect(dna.dimensions[Tag.BEACH]?.exposures).toBe(1);
  });

  it('discounts interest in things we showed relentlessly (exposure normalisation)', () => {
    expect(exposureNormalised(3, 0)).toBeCloseTo(3, 5);
    expect(exposureNormalised(3, 90)).toBeLessThan(exposureNormalised(3, 0));
    // Negative evidence is never discounted — a dislike is a dislike.
    expect(exposureNormalised(-3, 90)).toBe(-3);
  });

  it('does not blacklist every tag of one rejected experience', () => {
    // Gion carries six tags; disliking the place is not disliking all six
    // things equally. One rejection should lean, not condemn.
    const dna = observe(emptyDna('u1', T0), SignalKind.NOT_FOR_ME, [
      Tag.CULTURE,
      Tag.CITY,
      Tag.FOOD,
      Tag.ARCHITECTURE,
      Tag.HISTORY,
      Tag.SOCIAL,
    ]);
    expect(tagScore(dna, Tag.FOOD)).toBeLessThan(0);
    // ...but softly, and recoverable from.
    expect(tagScore(dna, Tag.FOOD)).toBeGreaterThan(-0.5);

    const recovered = [1, 2, 3].reduce((acc) => observe(acc, SignalKind.SAVE, [Tag.FOOD]), dna);
    expect(tagScore(recovered, Tag.FOOD)).toBeGreaterThan(0);
  });

  it('spreads a single-tag signal more sharply than a six-tag one', () => {
    const focused = observe(emptyDna('u1', T0), SignalKind.SAVE, [Tag.DESERT]);
    const diffuse = observe(emptyDna('u2', T0), SignalKind.SAVE, [
      Tag.DESERT,
      Tag.WARM,
      Tag.SOLITUDE,
      Tag.ADVENTURE,
      Tag.CAMPING,
      Tag.MINIMALISM,
    ]);
    expect(tagScore(focused, Tag.DESERT)).toBeGreaterThan(tagScore(diffuse, Tag.DESERT));
  });

  it('fades old evidence', () => {
    expect(decayFactor(T0, Date.parse(T0))).toBe(1);
    const halfLifeLater = Date.parse(T0) + 180 * 86_400_000;
    expect(decayFactor(T0, halfLifeLater)).toBeCloseTo(0.5, 2);
  });

  it('ranks a top taste after only a handful of interactions (learns fast)', () => {
    let dna = emptyDna('u1', T0);
    dna = observe(dna, SignalKind.ONBOARDING_PICK, [Tag.COLD, Tag.MOUNTAINS, Tag.SOLITUDE]);
    dna = observe(dna, SignalKind.SAVE, [Tag.COLD, Tag.PHOTOGRAPHY]);
    dna = observe(dna, SignalKind.OPEN, [Tag.MOUNTAINS, Tag.HIKING]);

    const top = topTastes(dna, 5, 0.2);
    expect(top.length).toBeGreaterThan(0);
    expect(top.map((entry) => entry.tag)).toContain(Tag.COLD);
  });

  it('grows profile completeness as it learns', () => {
    let dna = emptyDna('u1', T0);
    const before = completeness(dna);
    for (const tags of [
      [Tag.COLD, Tag.MOUNTAINS],
      [Tag.FOOD, Tag.CITY],
      [Tag.WATER, Tag.BEACH],
    ] as Tag[][]) {
      dna = observe(dna, SignalKind.SAVE, tags);
    }
    expect(completeness(dna)).toBeGreaterThan(before);
    expect(completeness(dna)).toBeLessThanOrEqual(1);
  });

  it('seeds a new profile from the population prior instead of blank', () => {
    const prior = new Map<Tag, number>([
      [Tag.NATURE, 0.6],
      [Tag.NIGHTLIFE, -0.3],
    ]);
    const seeded = seedFromPrior(emptyDna('u2', T0), prior, 1.5, T0);
    expect(tagScore(seeded, Tag.NATURE)).toBeGreaterThan(0);
    expect(tagScore(seeded, Tag.NIGHTLIFE)).toBeLessThan(0);
  });
});
