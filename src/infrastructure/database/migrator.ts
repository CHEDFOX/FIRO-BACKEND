import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from './database';

/**
 * A small forward-only migration runner.
 *
 * Plain .sql files applied in filename order, each inside a transaction, with a
 * checksum recorded so an already-applied migration cannot be edited unnoticed.
 * No migration library: the whole thing is ~80 lines and one less dependency
 * that can break a deploy.
 */

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name        text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`;

export class Migrator {
  constructor(
    private readonly db: Database,
    private readonly directory: string,
  ) {}

  /** Applies every migration not yet recorded. Returns the ones it ran. */
  async migrate(): Promise<string[]> {
    await this.db.query(MIGRATIONS_TABLE);

    const applied = new Map(
      (
        await this.db.query<{ name: string; checksum: string }>(
          'SELECT name, checksum FROM public.schema_migrations',
        )
      ).map((row) => [row.name, row.checksum]),
    );

    const files = readdirSync(this.directory)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // 001_, 002_, ... so order is explicit in the filename

    const ran: string[] = [];

    for (const file of files) {
      const sql = readFileSync(join(this.directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);

      if (previous !== undefined) {
        // Editing an applied migration means environments silently diverge:
        // this database has the old version, a fresh one gets the new.
        if (previous !== checksum) {
          throw new Error(
            `Migration "${file}" has changed since it was applied. ` +
              `Never edit an applied migration — add a new one instead.`,
          );
        }
        continue;
      }

      // Each migration is atomic: a failure leaves no partial schema behind.
      await this.db.transaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
      });

      ran.push(file);
    }

    return ran;
  }

  async status(): Promise<AppliedMigration[]> {
    await this.db.query(MIGRATIONS_TABLE);
    return this.db.query<AppliedMigration>(
      'SELECT name, checksum, applied_at AS "appliedAt" FROM public.schema_migrations ORDER BY name',
    );
  }
}
