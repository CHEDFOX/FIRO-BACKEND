import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { RefreshToken, RefreshTokenRepository } from '../../domain/refresh-token';

interface TokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  created_at: Date;
}

function toToken(row: TokenRow): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    deviceId: row.device_id,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    replacedById: row.replaced_by_id,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = `
  id, user_id, family_id, token_hash, device_id,
  expires_at, revoked_at, replaced_by_id, created_at
`;

@Injectable()
export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(token: RefreshToken): Promise<void> {
    await this.db.query(
      `INSERT INTO identity.refresh_tokens
         (id, user_id, family_id, token_hash, device_id,
          expires_at, revoked_at, replaced_by_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        token.id,
        token.userId,
        token.familyId,
        token.tokenHash,
        token.deviceId,
        token.expiresAt,
        token.revokedAt,
        token.replacedById,
        token.createdAt,
      ],
    );
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.db.queryOne<TokenRow>(
      `SELECT ${COLUMNS} FROM identity.refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    return row ? toToken(row) : null;
  }

  async update(token: RefreshToken): Promise<void> {
    await this.db.query(
      `UPDATE identity.refresh_tokens
         SET revoked_at = $2, replaced_by_id = $3, device_id = $4
       WHERE id = $1`,
      [token.id, token.revokedAt, token.replacedById, token.deviceId],
    );
  }

  async revokeFamily(familyId: string, at: string): Promise<void> {
    // Only unrevoked rows, so an earlier revocation timestamp is preserved.
    await this.db.query(
      `UPDATE identity.refresh_tokens
         SET revoked_at = $2
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, at],
    );
  }
}
