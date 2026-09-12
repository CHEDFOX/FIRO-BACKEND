import type { Provider, Type } from '@nestjs/common';
import { DATABASE, Database } from './database';

/**
 * Binds a repository port to either its Postgres or its in-memory adapter,
 * decided once at startup by whether a database is configured.
 *
 * This is the single place that choice is made. Modules declare intent —
 * "this port, these two adapters" — and never learn which one they got, which
 * is what keeps the swap invisible above the infrastructure layer.
 */
export function repositoryProvider(
  token: symbol,
  postgres: Type<unknown>,
  inMemory: Type<unknown>,
): Provider {
  return {
    provide: token,
    inject: [DATABASE, postgres, inMemory],
    useFactory: (db: Database | null, pg: unknown, memory: unknown): unknown => (db ? pg : memory),
  };
}
