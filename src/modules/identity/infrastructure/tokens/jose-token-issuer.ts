import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../../../bootstrap/config';
import { AppError } from '../../../../shared/errors/app-error';
import { isRole, Role } from '../../domain/role';
import {
  IssueAccessTokenInput,
  IssuedAccessToken,
  TokenIssuer,
  VerifiedAccessToken,
} from '../../domain/token-issuer';

/**
 * HS256 JWT access-token issuer (foundation). The production target is
 * asymmetric EdDSA + JWKS; because callers depend on the TokenIssuer port, that
 * swap is isolated to this adapter.
 */
@Injectable()
export class JoseTokenIssuer implements TokenIssuer {
  private readonly secret: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  async issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    const ttl = this.config.JWT_ACCESS_TTL_SECONDS;
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ roles: input.roles, sid: input.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + ttl)
      .sign(this.secret);
    return { token, expiresInSeconds: ttl };
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
      });
      const userId = payload.sub;
      const sessionId = payload['sid'];
      if (typeof userId !== 'string' || typeof sessionId !== 'string') {
        throw new Error('missing subject or session');
      }
      const rawRoles = payload['roles'];
      const roles: Role[] = Array.isArray(rawRoles) ? rawRoles.filter(isRole) : [];
      return { userId, roles, sessionId };
    } catch {
      throw AppError.unauthenticated('auth.invalid_token', 'Invalid or expired access token');
    }
  }
}
