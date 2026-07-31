import { Tag } from '../../catalog/domain/taxonomy';

/**
 * Short-term intent — "what you're into right now".
 *
 * Long-term DNA is deliberately slow and stable; on its own it makes a feed
 * that never seems to notice you. This layer sits on top and reacts within two
 * or three taps, then fades within the hour. Blending "right now" over "who you
 * are" is what makes a feed feel alive rather than static.
 */

/** Intent halves every ~15 minutes of inactivity. */
export const INTENT_HALF_LIFE_MS = 15 * 60 * 1000;

/** How strongly intent can override long-term taste at full strength. */
export const MAX_INTENT_INFLUENCE = 0.45;

export interface SessionIntent {
  readonly userId: string;
  readonly sessionId: string;
  /** tag -> raw accumulated intent weight. */
  readonly weights: Partial<Record<Tag, number>>;
  readonly updatedAt: string;
}

export function emptyIntent(userId: string, sessionId: string, now: string): SessionIntent {
  return { userId, sessionId, weights: {}, updatedAt: now };
}

export function decayIntent(intent: SessionIntent, nowMs: number): SessionIntent {
  const elapsed = nowMs - Date.parse(intent.updatedAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return intent;
  }
  const factor = 0.5 ** (elapsed / INTENT_HALF_LIFE_MS);
  const weights: Partial<Record<Tag, number>> = {};
  for (const [tag, weight] of Object.entries(intent.weights) as [Tag, number][]) {
    const next = weight * factor;
    // Drop dust so the object does not grow forever.
    if (Math.abs(next) > 0.01) {
      weights[tag] = next;
    }
  }
  return { ...intent, weights, updatedAt: new Date(nowMs).toISOString() };
}

export function applyIntent(
  intent: SessionIntent,
  tags: readonly Tag[],
  weight: number,
  nowMs: number,
): SessionIntent {
  if (weight === 0 || tags.length === 0) {
    return intent;
  }
  const decayedIntent = decayIntent(intent, nowMs);
  const weights = { ...decayedIntent.weights };
  for (const tag of tags) {
    weights[tag] = (weights[tag] ?? 0) + weight;
  }
  return { ...decayedIntent, weights, updatedAt: new Date(nowMs).toISOString() };
}

/**
 * Intent influence for a tag, squashed to -1..1 so a burst of taps cannot
 * completely hijack the feed — it bends it, it does not break it.
 */
export function intentScore(intent: SessionIntent, tag: Tag): number {
  const raw = intent.weights[tag] ?? 0;
  if (raw === 0) {
    return 0;
  }
  return Math.tanh(raw / 6);
}

/** Blend long-term taste with right-now intent. */
export function blendedScore(dnaScore: number, intent: number): number {
  const blended = dnaScore + MAX_INTENT_INFLUENCE * intent;
  return Math.max(-1, Math.min(1, blended));
}

export interface SessionIntentRepository {
  find(userId: string, sessionId: string): Promise<SessionIntent | null>;
  save(intent: SessionIntent): Promise<void>;
}

export const SESSION_INTENT_REPOSITORY = Symbol('SESSION_INTENT_REPOSITORY');
