import {
  Global,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../../bootstrap/config';
import { DATABASE, Database } from './database';
import { Migrator } from './migrator';

/**
 * Provides the Postgres pool application-wide, and runs migrations at startup.
 *
 * When DATABASE_URL is unset the provider resolves to `null`: the app then
 * binds the in-memory adapters instead and runs exactly as before. That keeps
 * tests fast and hermetic, and lets the API boot without a database.
 */
@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  constructor(
    @Inject(DATABASE) private readonly db: Database | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.db) {
      this.logger.warn(
        'DATABASE_URL is not set — using IN-MEMORY storage. All data is lost on restart.',
      );
      return;
    }

    if (!(await this.db.healthy())) {
      // Fail fast and loudly: a silently database-less API would look healthy
      // while quietly losing every write.
      throw new Error('Cannot reach the database. Check DATABASE_URL.');
    }

    if (this.config.DB_AUTO_MIGRATE) {
      const migrator = new Migrator(this.db, resolveMigrationsDir());
      const applied = await migrator.migrate();
      this.logger.log(
        applied.length > 0
          ? `applied ${applied.length} migration(s): ${applied.join(', ')}`
          : 'schema up to date',
      );
    }

    this.logger.log('connected to PostgreSQL');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db?.close();
  }
}

/**
 * Migrations ship as .sql next to the compiled output in the container, but sit
 * at the repo root in development.
 */
function resolveMigrationsDir(): string {
  return process.env['DB_MIGRATIONS_DIR'] ?? join(process.cwd(), 'db', 'migrations');
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Database | null => {
        if (!config.DATABASE_URL) {
          return null;
        }
        return new Database({
          connectionString: config.DATABASE_URL,
          maxConnections: config.DB_POOL_MAX,
          isProduction: config.isProduction,
        });
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
