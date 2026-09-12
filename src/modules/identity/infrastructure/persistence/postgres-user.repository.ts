import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { Role } from '../../domain/role';
import type { User, UserStatus } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';

interface UserRow {
  id: string;
  handle: string;
  email: string | null;
  email_verified: boolean;
  password_hash: string | null;
  display_name: string | null;
  locale: string;
  roles: string[];
  status: string;
  created_at: Date;
  updated_at: Date;
  version: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    emailVerified: row.email_verified,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    locale: row.locale,
    roles: row.roles as Role[],
    status: row.status as UserStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    // bigint arrives as a string from pg (it exceeds JS safe integers).
    version: Number(row.version),
  };
}

const COLUMNS = `
  id, handle, email, email_verified, password_hash, display_name,
  locale, roles, status, created_at, updated_at, version
`;

/**
 * Postgres-backed users. Implements the same port as the in-memory adapter, so
 * swapping between them changes nothing above the infrastructure layer.
 */
@Injectable()
export class PostgresUserRepository implements UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users WHERE id = $1`,
      [id],
    );
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    // citext makes this case-insensitive without lower() defeating the index.
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users WHERE email = $1`,
      [email],
    );
    return row ? toUser(row) : null;
  }

  async findByHandle(handle: string): Promise<User | null> {
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${COLUMNS} FROM identity.users WHERE handle = $1`,
      [handle],
    );
    return row ? toUser(row) : null;
  }

  async save(user: User): Promise<void> {
    await this.db.query(
      `INSERT INTO identity.users
         (id, handle, email, email_verified, password_hash, display_name,
          locale, roles, status, created_at, updated_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         handle = EXCLUDED.handle,
         email = EXCLUDED.email,
         email_verified = EXCLUDED.email_verified,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         locale = EXCLUDED.locale,
         roles = EXCLUDED.roles,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         version = EXCLUDED.version`,
      [
        user.id,
        user.handle,
        user.email,
        user.emailVerified,
        user.passwordHash,
        user.displayName,
        user.locale,
        user.roles,
        user.status,
        user.createdAt,
        user.updatedAt,
        user.version,
      ],
    );
  }
}
