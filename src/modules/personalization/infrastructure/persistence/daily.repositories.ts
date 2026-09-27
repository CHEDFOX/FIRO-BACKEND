import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { Tag } from '../../../catalog/domain/taxonomy';
import type {
  DailyPick,
  DailyPickRepository,
  Rhythm,
  RhythmMode,
  RhythmRepository,
} from '../../domain/daily.repository';

// ------------------------------------------------------------- postgres -----

interface PickRow {
  user_id: string;
  day: string;
  experience_id: string;
  reason: string | null;
  is_wildcard: boolean;
  chosen_at: Date;
}

// `day::text` so pg hands back 'YYYY-MM-DD' instead of a Date at local
// midnight, which would shift a day for anyone west of the server.
const PICK_COLUMNS = `user_id, day::text AS day, experience_id, reason, is_wildcard, chosen_at`;

function toPick(row: PickRow): DailyPick {
  return {
    userId: row.user_id,
    day: row.day,
    experienceId: row.experience_id,
    reason: row.reason,
    isWildcard: row.is_wildcard,
    chosenAt: row.chosen_at.toISOString(),
  };
}

@Injectable()
export class PostgresDailyPickRepository implements DailyPickRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(userId: string, day: string): Promise<DailyPick | null> {
    const row = await this.db.queryOne<PickRow>(
      `SELECT ${PICK_COLUMNS} FROM personalization.daily_picks WHERE user_id = $1 AND day = $2`,
      [userId, day],
    );
    return row ? toPick(row) : null;
  }

  async saveIfAbsent(pick: DailyPick): Promise<DailyPick> {
    // DO NOTHING + re-read, rather than DO UPDATE: the first writer must win,
    // or a second concurrent request would replace a pick already on screen.
    await this.db.query(
      `INSERT INTO personalization.daily_picks
         (user_id, day, experience_id, reason, is_wildcard, chosen_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, day) DO NOTHING`,
      [pick.userId, pick.day, pick.experienceId, pick.reason, pick.isWildcard, pick.chosenAt],
    );
    return (await this.find(pick.userId, pick.day)) ?? pick;
  }

  async listBetween(userId: string, fromDay: string, toDay: string): Promise<DailyPick[]> {
    const rows = await this.db.query<PickRow>(
      `SELECT ${PICK_COLUMNS} FROM personalization.daily_picks
       WHERE user_id = $1 AND day BETWEEN $2 AND $3
       ORDER BY day ASC`,
      [userId, fromDay, toDay],
    );
    return rows.map(toPick);
  }

  async recent(userId: string, limit: number): Promise<DailyPick[]> {
    const rows = await this.db.query<PickRow>(
      `SELECT ${PICK_COLUMNS} FROM personalization.daily_picks
       WHERE user_id = $1 ORDER BY day DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toPick);
  }
}

interface RhythmRow {
  user_id: string;
  mode: string;
  notify_at: string | null;
  timezone: string;
  surprise_next: boolean;
  surprise_toward: string | null;
  updated_at: Date;
}

@Injectable()
export class PostgresRhythmRepository implements RhythmRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(userId: string): Promise<Rhythm | null> {
    const row = await this.db.queryOne<RhythmRow>(
      `SELECT user_id, mode, to_char(notify_at, 'HH24:MI') AS notify_at, timezone,
              surprise_next, surprise_toward, updated_at
       FROM personalization.rhythms WHERE user_id = $1`,
      [userId],
    );
    if (!row) {
      return null;
    }
    return {
      userId: row.user_id,
      mode: row.mode as RhythmMode,
      notifyAt: row.notify_at,
      timezone: row.timezone,
      surpriseNext: row.surprise_next,
      surpriseToward: row.surprise_toward as Tag | null,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async save(rhythm: Rhythm): Promise<void> {
    await this.db.query(
      `INSERT INTO personalization.rhythms
         (user_id, mode, notify_at, timezone, surprise_next, surprise_toward, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         notify_at = EXCLUDED.notify_at,
         timezone = EXCLUDED.timezone,
         surprise_next = EXCLUDED.surprise_next,
         surprise_toward = EXCLUDED.surprise_toward,
         updated_at = EXCLUDED.updated_at`,
      [
        rhythm.userId,
        rhythm.mode,
        rhythm.notifyAt,
        rhythm.timezone,
        rhythm.surpriseNext,
        rhythm.surpriseToward,
        rhythm.updatedAt,
      ],
    );
  }
}

// ------------------------------------------------------------ in-memory -----

@Injectable()
export class InMemoryDailyPickRepository implements DailyPickRepository {
  private readonly byKey = new Map<string, DailyPick>();

  async find(userId: string, day: string): Promise<DailyPick | null> {
    return this.byKey.get(`${userId}|${day}`) ?? null;
  }

  async saveIfAbsent(pick: DailyPick): Promise<DailyPick> {
    const key = `${pick.userId}|${pick.day}`;
    const existing = this.byKey.get(key);
    if (existing) {
      return existing;
    }
    this.byKey.set(key, pick);
    return pick;
  }

  async listBetween(userId: string, fromDay: string, toDay: string): Promise<DailyPick[]> {
    return [...this.byKey.values()]
      .filter((pick) => pick.userId === userId && pick.day >= fromDay && pick.day <= toDay)
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  async recent(userId: string, limit: number): Promise<DailyPick[]> {
    return [...this.byKey.values()]
      .filter((pick) => pick.userId === userId)
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, limit);
  }

  /** Test helper: plant a pick on an arbitrary past day. */
  plant(pick: DailyPick): void {
    this.byKey.set(`${pick.userId}|${pick.day}`, pick);
  }
}

@Injectable()
export class InMemoryRhythmRepository implements RhythmRepository {
  private readonly byUser = new Map<string, Rhythm>();

  async find(userId: string): Promise<Rhythm | null> {
    return this.byUser.get(userId) ?? null;
  }

  async save(rhythm: Rhythm): Promise<void> {
    this.byUser.set(rhythm.userId, rhythm);
  }
}
