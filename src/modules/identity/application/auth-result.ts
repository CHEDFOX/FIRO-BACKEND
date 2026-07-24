import { PublicUser, User } from '../domain/user';

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  readonly accessExpiresInSeconds: number;
}

/** Result of register/login/refresh: the user plus a fresh token pair. */
export interface AuthResult {
  readonly user: User;
  readonly tokens: AuthTokens;
}

export interface PublicAuthResult {
  readonly user: PublicUser;
  readonly tokens: AuthTokens;
}
