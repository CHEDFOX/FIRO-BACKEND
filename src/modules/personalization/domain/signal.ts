/**
 * Behavioural signals — the raw evidence Explorer DNA learns from.
 *
 * Weights encode how much each action really tells us about taste. Saving is
 * the strongest explicit signal; a fast scroll-past is weak but genuinely
 * negative. Negative evidence matters: a profile learned only from likes goes
 * bland, because it can never rule anything out.
 */

export const SignalKind = {
  IMPRESSION: 'impression',
  DWELL: 'dwell',
  OPEN: 'open',
  SAVE: 'save',
  UNSAVE: 'unsave',
  SHARE: 'share',
  ADD_TO_TRIP: 'add_to_trip',
  SKIP: 'skip',
  NOT_FOR_ME: 'not_for_me',
  MORE_LIKE_THIS: 'more_like_this',
  ONBOARDING_PICK: 'onboarding_pick',
  ONBOARDING_REJECT: 'onboarding_reject',
} as const;

export type SignalKind = (typeof SignalKind)[keyof typeof SignalKind];

export const ALL_SIGNAL_KINDS: readonly SignalKind[] = Object.values(SignalKind);

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === 'string' && (ALL_SIGNAL_KINDS as readonly string[]).includes(value);
}

/**
 * Evidence weight per signal. Positive values add positive evidence, negative
 * values add negative evidence.
 *
 * An IMPRESSION is weight 0 on purpose: being *shown* something is not
 * evidence of taste, it is evidence of what we chose to show. It is still
 * recorded, because exposure counts are what let us normalise interactions
 * against what the user actually had the chance to react to.
 */
export const SIGNAL_WEIGHT: Record<SignalKind, number> = {
  [SignalKind.IMPRESSION]: 0,
  [SignalKind.DWELL]: 0.5, // scaled by duration, see dwellWeight()
  [SignalKind.OPEN]: 1,
  [SignalKind.SAVE]: 3,
  [SignalKind.UNSAVE]: -3,
  [SignalKind.SHARE]: 2,
  [SignalKind.ADD_TO_TRIP]: 4,
  [SignalKind.SKIP]: -0.5,
  [SignalKind.NOT_FOR_ME]: -5,
  [SignalKind.MORE_LIKE_THIS]: 4,
  [SignalKind.ONBOARDING_PICK]: 2.5,
  [SignalKind.ONBOARDING_REJECT]: -1.5,
};

/** Below this, a "dwell" is really a scroll-past and carries no positive weight. */
export const MIN_MEANINGFUL_DWELL_MS = 1200;
/** Dwell weight saturates here — staring for a minute is not 30x a 2s look. */
export const DWELL_SATURATION_MS = 12_000;

/**
 * Lingering on a photo is the strongest *passive* signal in a visual product:
 * it is desire, measured without asking. Scaled and capped so it can never
 * dominate an explicit save.
 */
export function dwellWeight(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < MIN_MEANINGFUL_DWELL_MS) {
    return SIGNAL_WEIGHT[SignalKind.SKIP];
  }
  const capped = Math.min(durationMs, DWELL_SATURATION_MS);
  const ratio =
    (capped - MIN_MEANINGFUL_DWELL_MS) / (DWELL_SATURATION_MS - MIN_MEANINGFUL_DWELL_MS);
  // 0.5 at the threshold, up to 2.0 when saturated.
  return 0.5 + 1.5 * ratio;
}

export interface Signal {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly kind: SignalKind;
  readonly experienceId: string;
  /** Only for DWELL. */
  readonly durationMs: number | null;
  readonly occurredAt: string;
}

/** The evidence weight this signal carries (dwell is duration-scaled). */
export function weightOf(signal: Pick<Signal, 'kind' | 'durationMs'>): number {
  if (signal.kind === SignalKind.DWELL) {
    return dwellWeight(signal.durationMs ?? 0);
  }
  return SIGNAL_WEIGHT[signal.kind];
}

export interface SignalRepository {
  append(signal: Signal): Promise<void>;
  listForUser(userId: string, limit?: number): Promise<Signal[]>;
  countForUser(userId: string): Promise<number>;
}

export const SIGNAL_REPOSITORY = Symbol('SIGNAL_REPOSITORY');
