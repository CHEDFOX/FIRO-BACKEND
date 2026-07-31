import { Tag } from '../../catalog/domain/taxonomy';
import {
  applyIntent,
  blendedScore,
  decayIntent,
  emptyIntent,
  INTENT_HALF_LIFE_MS,
  intentScore,
} from './session-intent';

const T0 = '2026-01-01T00:00:00.000Z';
const T0_MS = Date.parse(T0);

describe('session intent', () => {
  it('reacts within a couple of taps', () => {
    let intent = emptyIntent('u1', 's1', T0);
    expect(intentScore(intent, Tag.DESERT)).toBe(0);

    intent = applyIntent(intent, [Tag.DESERT], 3, T0_MS);
    intent = applyIntent(intent, [Tag.DESERT], 3, T0_MS + 1000);

    expect(intentScore(intent, Tag.DESERT)).toBeGreaterThan(0.4);
  });

  it('fades as the session goes quiet', () => {
    let intent = applyIntent(emptyIntent('u1', 's1', T0), [Tag.CITY], 4, T0_MS);
    const immediately = intentScore(intent, Tag.CITY);

    intent = decayIntent(intent, T0_MS + INTENT_HALF_LIFE_MS);
    const later = intentScore(intent, Tag.CITY);

    expect(later).toBeLessThan(immediately);
    expect(later).toBeGreaterThan(0);
  });

  it('drops to nothing after a long gap', () => {
    let intent = applyIntent(emptyIntent('u1', 's1', T0), [Tag.CITY], 4, T0_MS);
    intent = decayIntent(intent, T0_MS + 20 * INTENT_HALF_LIFE_MS);
    expect(intentScore(intent, Tag.CITY)).toBeCloseTo(0, 3);
  });

  it('bends long-term taste without overriding it', () => {
    // Strong long-term dislike plus a burst of right-now interest.
    const blended = blendedScore(-0.8, 1);
    expect(blended).toBeLessThan(0); // still negative overall
    expect(blended).toBeGreaterThan(-0.8); // but softened

    // Neutral taste plus strong intent leans positive.
    expect(blendedScore(0, 1)).toBeGreaterThan(0.3);
  });

  it('is bounded — a tap burst cannot hijack the feed', () => {
    let intent = emptyIntent('u1', 's1', T0);
    for (let i = 0; i < 50; i += 1) {
      intent = applyIntent(intent, [Tag.NIGHTLIFE], 4, T0_MS);
    }
    expect(intentScore(intent, Tag.NIGHTLIFE)).toBeLessThanOrEqual(1);
    expect(blendedScore(0, intentScore(intent, Tag.NIGHTLIFE))).toBeLessThanOrEqual(1);
  });

  it('records negative intent too', () => {
    const intent = applyIntent(emptyIntent('u1', 's1', T0), [Tag.LUXURY], -5, T0_MS);
    expect(intentScore(intent, Tag.LUXURY)).toBeLessThan(0);
  });
});
