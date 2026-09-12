import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * The Postgres connection pool and query helpers.
 *
 * Deliberately thin — no ORM. The repository ports already define the exact
 * queries each module needs, so an ORM would add a second abstraction on top of
 * one that already exists, and hide the SQL we care about tuning.
 */

export const DATABASE = Symbol('DATABASE');

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly isProduction?: boolean;
}

export class Database {
  readonly pool: Pool;

  constructor(options: DatabaseOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Managed providers (and anything across the public internet) require
      // TLS; a local container does not offer it.
      ssl:
        options.isProduction &&
        !/localhost|127\.0\.0\.1|@db:|@postgres:/.test(options.connectionString)
          ? { rejectUnauthorized: false }
          : undefined,
    });

    // Without this an idle-client error (e.g. the database restarting) is an
    // unhandled 'error' event, which takes the whole process down.
    this.pool.on('error', (error) => {
      console.error('[database] idle client error:', error.message);
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as unknown[]);
    return result.rows;
  }

  /** First row, or null. For lookups that expect at most one match. */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Run several statements atomically. Rolls back on any throw, so a caller
   * cannot leave a half-applied change behind.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
