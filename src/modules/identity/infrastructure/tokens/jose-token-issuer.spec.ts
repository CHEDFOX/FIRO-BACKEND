import { loadConfig } from '../../../../bootstrap/config';
import { AppError } from '../../../../shared/errors/app-error';
import { Role } from '../../domain/role';
import { JoseTokenIssuer } from './jose-token-issuer';

describe('JoseTokenIssuer', () => {
  const config = loadConfig({ JWT_SECRET: 'a-sufficiently-long-test-secret-value' });
  const issuer = new JoseTokenIssuer(config);

  it('issues a verifiable access token carrying subject, roles and session', async () => {
    const issued = await issuer.issueAccessToken({
      userId: 'user-1',
      roles: [Role.USER, Role.ADMIN],
      sessionId: 'sess-1',
    });
    expect(issued.expiresInSeconds).toBe(config.JWT_ACCESS_TTL_SECONDS);

    const verified = await issuer.verifyAccessToken(issued.token);
    expect(verified.userId).toBe('user-1');
    expect(verified.sessionId).toBe('sess-1');
    expect(verified.roles).toEqual([Role.USER, Role.ADMIN]);
  });

  it('rejects a tampered/garbage token as unauthenticated', async () => {
    await expect(issuer.verifyAccessToken('not.a.jwt')).rejects.toBeInstanceOf(AppError);
    try {
      await issuer.verifyAccessToken('not.a.jwt');
    } catch (e) {
      expect((e as AppError).httpStatus).toBe(401);
      expect((e as AppError).code).toBe('auth.invalid_token');
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new JoseTokenIssuer(
      loadConfig({ JWT_SECRET: 'a-totally-different-secret-value!!' }),
    );
    const foreign = await other.issueAccessToken({
      userId: 'u',
      roles: [Role.USER],
      sessionId: 's',
    });
    await expect(issuer.verifyAccessToken(foreign.token)).rejects.toBeInstanceOf(AppError);
  });
});
