import type { Tag } from '../../catalog/domain/taxonomy';

export interface DailyPick {
  readonly userId: string;
  /** The user's local calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly experienceId: string;
  readonly reason: string | null;
  readonly isWildcard: boolean;
  readonly chosenAt: string;
}

export interface DailyPickRepository {
  find(userId: string, day: string): Promise<DailyPick | null>;
  /**
   * Stores the pick unless one already exists for that day, and returns
   * whichever is stored.
   *
   * Two requests on the first open of the day (a double-tap, a slow network
   * retry) can both compute a pick. Whichever lands first wins and the other
   * reads it back, so the user never sees today change between two screens.
   */
  saveIfAbsent(pick: DailyPick): Promise<DailyPick>;
  /** Inclusive range, oldest first. */
  listBetween(userId: string, fromDay: string, toDay: string): Promise<DailyPick[]>;
  /** Newest first. */
  recent(userId: string, limit: number): Promise<DailyPick[]>;
}

export const DAILY_PICK_REPOSITORY = Symbol('DAILY_PICK_REPOSITORY');

export type RhythmMode = 'morning' | 'evening' | 'none';

export interface Rhythm {
  readonly userId: string;
  readonly mode: RhythmMode;
  /** Local wall-clock time, HH:MM. Null when mode is none. */
  readonly notifyAt: string | null;
  readonly timezone: string;
  readonly surpriseNext: boolean;
  readonly surpriseToward: Tag | null;
  readonly updatedAt: string;
}

export function defaultRhythm(userId: string, now: string): Rhythm {
  return {
    userId,
    mode: 'none',
    notifyAt: null,
    timezone: 'UTC',
    surpriseNext: false,
    surpriseToward: null,
    updatedAt: now,
  };
}

export interface RhythmRepository {
  find(userId: string): Promise<Rhythm | null>;
  save(rhythm: Rhythm): Promise<void>;
}

export const RHYTHM_REPOSITORY = Symbol('RHYTHM_REPOSITORY');
