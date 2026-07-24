/**
 * Refresh tokens are opaque, high-entropy strings. Only their hash is stored.
 * Tokens are grouped into a "family" (per login/device); rotating a token
 * revokes the previous one. Presenting an already-revoked token is treated as
 * theft and revokes the whole family (reuse detection).
 */
export interface RefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly deviceId: string | null;
  readonly expiresAt: string; // ISO-8601
  readonly revokedAt: string | null; // ISO-8601 or null
  readonly replacedById: string | null;
  readonly createdAt: string; // ISO-8601
}

export interface RefreshTokenRepository {
  create(token: RefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  update(token: RefreshToken): Promise<void>;
  /** Revoke every non-revoked token in a family (reuse detection / logout). */
  revokeFamily(familyId: string, at: string): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

/**
 * Port for generating and hashing the opaque refresh token value. Refresh
 * tokens are high-entropy, so a fast one-way hash (SHA-256) is sufficient and
 * appropriate — unlike passwords, which need a slow KDF.
 */
export interface RefreshTokenCodec {
  generate(): string;
  hash(raw: string): string;
}

export const REFRESH_TOKEN_CODEC = Symbol('REFRESH_TOKEN_CODEC');
