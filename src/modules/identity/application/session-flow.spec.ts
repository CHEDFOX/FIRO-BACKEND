import { loadConfig } from '../../../bootstrap/config';
import { AppError } from '../../../shared/errors/app-error';
import { ScryptPasswordHasher } from '../infrastructure/crypto/scrypt-password-hasher';
import { Sha256RefreshTokenCodec } from '../infrastructure/crypto/sha256-refresh-token.codec';
import { InMemoryRefreshTokenRepository } from '../infrastructure/persistence/in-memory-refresh-token.repository';
import { InMemoryUserRepository } from '../infrastructure/persistence/in-memory-user.repository';
import { JoseTokenIssuer } from '../infrastructure/tokens/jose-token-issuer';
import { LoginUseCase } from './login.usecase';
import { RefreshSessionUseCase } from './refresh-session.usecase';
import { RegisterUserUseCase } from './register-user.usecase';
import { SessionManager } from './session-manager';

function wire() {
  const config = loadConfig({ JWT_SECRET: 'integration-test-secret-value-long-enough' });
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const hasher = new ScryptPasswordHasher();
  const codec = new Sha256RefreshTokenCodec();
  const issuer = new JoseTokenIssuer(config);
  const sessions = new SessionManager(users, refreshTokens, codec, issuer, config);
  return {
    issuer,
    register: new RegisterUserUseCase(users, hasher, sessions),
    login: new LoginUseCase(users, hasher, sessions),
    refresh: new RefreshSessionUseCase(sessions),
  };
}

const base = { email: 'alex@firo.app', password: 'sup3r-secret-pw', handle: 'alex' };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected the promise to reject');
  } catch (e) {
    if (e instanceof AppError) {
      return e.code;
    }
    throw e;
  }
}

describe('identity session flow', () => {
  it('registers a user and returns a valid access token', async () => {
    const { register, issuer } = wire();
    const result = await register.execute(base);
    expect(result.user.email).toBe('alex@firo.app');
    expect(result.user.roles).toEqual(['user']);
    const verified = await issuer.verifyAccessToken(result.tokens.accessToken);
    expect(verified.userId).toBe(result.user.id);
  });

  it('rejects duplicate email and handle', async () => {
    const { register } = wire();
    await register.execute(base);
    expect(await codeOf(register.execute({ ...base, handle: 'other' }))).toBe(
      'identity.email_taken',
    );
    expect(await codeOf(register.execute({ ...base, email: 'x@firo.app' }))).toBe(
      'identity.handle_taken',
    );
  });

  it('logs in with correct credentials and rejects wrong ones uniformly', async () => {
    const { register, login } = wire();
    await register.execute(base);

    const ok = await login.execute({ email: base.email, password: base.password });
    expect(ok.tokens.accessToken).toBeTruthy();

    expect(await codeOf(login.execute({ email: base.email, password: 'wrong' }))).toBe(
      'auth.invalid_credentials',
    );
    // unknown account yields the SAME error (no account enumeration)
    expect(await codeOf(login.execute({ email: 'nobody@firo.app', password: 'whatever' }))).toBe(
      'auth.invalid_credentials',
    );
  });

  it('rotates refresh tokens and detects reuse (revoking the family)', async () => {
    const { register, refresh } = wire();
    const first = await register.execute(base);
    const r1 = first.tokens.refreshToken;

    const rotated = await refresh.execute({ refreshToken: r1 });
    const r2 = rotated.tokens.refreshToken;
    expect(r2).not.toBe(r1);

    // reusing the old (now-revoked) token is detected as theft
    expect(await codeOf(refresh.execute({ refreshToken: r1 }))).toBe('auth.refresh_token_reused');

    // ...and the whole family is revoked, so the rotated token is dead too
    expect(await codeOf(refresh.execute({ refreshToken: r2 }))).toBe('auth.refresh_token_reused');
  });
});
