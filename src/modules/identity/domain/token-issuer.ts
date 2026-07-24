import { Role } from './role';

export interface IssueAccessTokenInput {
  readonly userId: string;
  readonly roles: Role[];
  readonly sessionId: string;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresInSeconds: number;
}

export interface VerifiedAccessToken {
  readonly userId: string;
  readonly roles: Role[];
  readonly sessionId: string;
}

/**
 * Port for signing/verifying stateless access tokens. Foundation uses HS256;
 * the production target is asymmetric EdDSA with a published JWKS. Because
 * callers depend only on this interface, that swap is isolated to the adapter.
 */
export interface TokenIssuer {
  issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken>;
  /** Throws AppError.unauthenticated on any invalid/expired token. */
  verifyAccessToken(token: string): Promise<VerifiedAccessToken>;
}

export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');
