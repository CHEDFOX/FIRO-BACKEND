import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../bootstrap/config';
import { AppError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../shared/ids';
import {
  REFRESH_TOKEN_CODEC,
  REFRESH_TOKEN_REPOSITORY,
  RefreshToken,
  RefreshTokenCodec,
  RefreshTokenRepository,
} from '../domain/refresh-token';
import { TOKEN_ISSUER, TokenIssuer } from '../domain/token-issuer';
import { isActive, User } from '../domain/user';
import { USER_REPOSITORY, UserRepository } from '../domain/user.repository';
import { AuthResult, AuthTokens } from './auth-result';

/**
 * Orchestrates session lifecycle: issuing an access+refresh pair, rotating the
 * refresh token (with reuse detection), and revoking a session family. Kept
 * separate from the use cases so register/login/refresh all share one, audited
 * code path.
 */
@Injectable()
export class SessionManager {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(REFRESH_TOKEN_CODEC) private readonly codec: RefreshTokenCodec,
    @Inject(TOKEN_ISSUER) private readonly tokenIssuer: TokenIssuer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Start a brand-new session (new family) for a user. */
  async startSession(
    user: User,
    deviceId: string | null,
    now: number = Date.now(),
  ): Promise<AuthTokens> {
    const familyId = uuidv7(now);
    return this.mintTokens(user, familyId, deviceId, now);
  }

  /**
   * Rotate a refresh token. Returns the user (for a fresh access token) and a
   * new token pair. Detects reuse of a revoked token and kills the family.
   */
  async rotate(
    rawRefreshToken: string,
    deviceId: string | null,
    now: number = Date.now(),
  ): Promise<AuthResult> {
    const hash = this.codec.hash(rawRefreshToken);
    const existing = await this.refreshTokens.findByHash(hash);

    if (!existing) {
      throw AppError.unauthenticated('auth.invalid_refresh_token', 'Invalid refresh token');
    }
    if (existing.revokedAt !== null) {
      // Reuse of an already-rotated token => probable theft. Revoke the family.
      await this.refreshTokens.revokeFamily(existing.familyId, new Date(now).toISOString());
      throw AppError.unauthenticated(
        'auth.refresh_token_reused',
        'Refresh token has already been used',
      );
    }
    if (Date.parse(existing.expiresAt) <= now) {
      throw AppError.unauthenticated('auth.refresh_token_expired', 'Refresh token has expired');
    }

    const user = await this.users.findById(existing.userId);
    if (!user || !isActive(user)) {
      throw AppError.unauthenticated('auth.account_inactive', 'Account is not active');
    }

    const newId = uuidv7(now);
    const tokens = await this.mintTokens(
      user,
      existing.familyId,
      deviceId ?? existing.deviceId,
      now,
      newId,
    );

    const rotated: RefreshToken = {
      ...existing,
      revokedAt: new Date(now).toISOString(),
      replacedById: newId,
    };
    await this.refreshTokens.update(rotated);

    return { user, tokens };
  }

  /** Revoke an entire session family given any refresh token from it. */
  async revoke(rawRefreshToken: string, now: number = Date.now()): Promise<void> {
    const hash = this.codec.hash(rawRefreshToken);
    const existing = await this.refreshTokens.findByHash(hash);
    if (existing) {
      await this.refreshTokens.revokeFamily(existing.familyId, new Date(now).toISOString());
    }
    // Idempotent: unknown token is a no-op (do not leak whether it existed).
  }

  private async mintTokens(
    user: User,
    familyId: string,
    deviceId: string | null,
    now: number,
    tokenId: string = uuidv7(now),
  ): Promise<AuthTokens> {
    const raw = this.codec.generate();
    const record: RefreshToken = {
      id: tokenId,
      userId: user.id,
      familyId,
      tokenHash: this.codec.hash(raw),
      deviceId,
      expiresAt: new Date(now + this.config.JWT_REFRESH_TTL_SECONDS * 1000).toISOString(),
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(now).toISOString(),
    };
    await this.refreshTokens.create(record);

    const access = await this.tokenIssuer.issueAccessToken({
      userId: user.id,
      roles: user.roles,
      sessionId: familyId,
    });

    return {
      accessToken: access.token,
      refreshToken: raw,
      tokenType: 'Bearer',
      accessExpiresInSeconds: access.expiresInSeconds,
    };
  }
}
