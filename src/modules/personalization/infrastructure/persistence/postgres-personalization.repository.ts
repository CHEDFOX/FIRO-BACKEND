import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { Tag } from '../../../catalog/domain/taxonomy';
import type { DnaRepository } from '../../domain/dna.repository';
import type { DnaVector, ExplorerDna } from '../../domain/explorer-dna';
import type { Signal, SignalKind, SignalRepository } from '../../domain/signal';

interface DnaRow {
  user_id: string;
  dimensions: DnaVector;
  signal_count: number;
  updated_at: Date;
  version: string;
}

/** Below this many profiles an "average" is noise, and seeding from noise is
 *  worse than seeding from nothing. */
const MIN_PROFILES_FOR_PRIOR = 5;

@Injectable()
export class PostgresDnaRepository implements DnaRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(userId: string): Promise<ExplorerDna | null> {
    const row = await this.db.queryOne<DnaRow>(
      `SELECT user_id, dimensions, signal_count, updated_at, version
       FROM personalization.dna_profiles WHERE user_id = $1`,
      [userId],
    );
    if (!row) {
      return null;
    }
    return {
      userId: row.user_id,
      dimensions: row.dimensions ?? {},
      signalCount: row.signal_count,
      updatedAt: row.updated_at.toISOString(),
      version: Number(row.version),
    };
  }

  async save(dna: ExplorerDna): Promise<void> {
    await this.db.query(
      `INSERT INTO personalization.dna_profiles
         (user_id, dimensions, signal_count, updated_at, version)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         dimensions = EXCLUDED.dimensions,
         signal_count = EXCLUDED.signal_count,
         updated_at = EXCLUDED.updated_at,
         version = EXCLUDED.version`,
      [dna.userId, JSON.stringify(dna.dimensions), dna.signalCount, dna.updatedAt, dna.version],
    );
  }

  /**
   * Average taste across known profiles, so a brand-new user starts somewhere
   * sane instead of blank. Computed in SQL by expanding each profile's JSONB
   * into rows and averaging the net evidence per tag.
   */
  async populationPrior(): Promise<ReadonlyMap<Tag, number>> {
    const total = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM personalization.dna_profiles`,
    );
    if (!total || Number(total.count) < MIN_PROFILES_FOR_PRIOR) {
      return new Map();
    }

    const rows = await this.db.query<{ tag: string; mean: number }>(
      `SELECT key AS tag,
              avg( COALESCE((value->>'positive')::float, 0)
                 - COALESCE((value->>'negative')::float, 0) ) AS mean
       FROM personalization.dna_profiles,
            LATERAL jsonb_each(dimensions)
       GROUP BY key`,
    );

    const prior = new Map<Tag, number>();
    for (const row of rows) {
      // Normalise into a modest range so the prior nudges rather than dictates.
      prior.set(row.tag as Tag, Math.max(-1, Math.min(1, row.mean / 10)));
    }
    return prior;
  }
}

interface SignalRow {
  id: string;
  user_id: string;
  session_id: string | null;
  kind: string;
  experience_id: string | null;
  duration_ms: number | null;
  occurred_at: Date;
}

@Injectable()
export class PostgresSignalRepository implements SignalRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async append(signal: Signal): Promise<void> {
    // The identity column owns the primary key; the application id is not
    // stored, because this table is an append-only log nothing references.
    await this.db.query(
      `INSERT INTO personalization.signals
         (user_id, session_id, kind, experience_id, duration_ms, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        signal.userId,
        signal.sessionId,
        signal.kind,
        signal.experienceId,
        signal.durationMs,
        signal.occurredAt,
      ],
    );
  }

  async listForUser(userId: string, limit = 500): Promise<Signal[]> {
    const rows = await this.db.query<SignalRow>(
      `SELECT id::text, user_id, session_id, kind, experience_id, duration_ms, occurred_at
       FROM personalization.signals
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      kind: row.kind as SignalKind,
      experienceId: row.experience_id ?? '',
      durationMs: row.duration_ms,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async countForUser(userId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM personalization.signals WHERE user_id = $1`,
      [userId],
    );
    return row ? Number(row.count) : 0;
  }
}
