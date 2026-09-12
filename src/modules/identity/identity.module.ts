import { Module } from '@nestjs/common';
import { GetCurrentUserUseCase } from './application/get-current-user.usecase';
import { LoginUseCase } from './application/login.usecase';
import { RefreshSessionUseCase } from './application/refresh-session.usecase';
import { RegisterUserUseCase } from './application/register-user.usecase';
import { RevokeSessionUseCase } from './application/revoke-session.usecase';
import { SessionManager } from './application/session-manager';
import { PASSWORD_HASHER } from './domain/password-hasher';
import { REFRESH_TOKEN_CODEC, REFRESH_TOKEN_REPOSITORY } from './domain/refresh-token';
import { TOKEN_ISSUER } from './domain/token-issuer';
import { USER_REPOSITORY } from './domain/user.repository';
import { ScryptPasswordHasher } from './infrastructure/crypto/scrypt-password-hasher';
import { Sha256RefreshTokenCodec } from './infrastructure/crypto/sha256-refresh-token.codec';
import { AuthController } from './infrastructure/http/auth.controller';
import { JwtAuthGuard } from './infrastructure/http/jwt-auth.guard';
import { RolesGuard } from './infrastructure/http/roles.guard';
import { repositoryProvider } from '../../infrastructure/database/repository-provider';
import { InMemoryRefreshTokenRepository } from './infrastructure/persistence/in-memory-refresh-token.repository';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory-user.repository';
import { PostgresRefreshTokenRepository } from './infrastructure/persistence/postgres-refresh-token.repository';
import { PostgresUserRepository } from './infrastructure/persistence/postgres-user.repository';
import { JoseTokenIssuer } from './infrastructure/tokens/jose-token-issuer';

/**
 * Identity bounded context: accounts, authentication (email/password + JWT with
 * rotating refresh tokens), and RBAC guards.
 *
 * Persistence is in-memory for the foundation phase; the Postgres adapters slot
 * in behind USER_REPOSITORY / REFRESH_TOKEN_REPOSITORY with no change to domain
 * or application code. OAuth (Apple/Google) and the DB adapters are added in a
 * later phase.
 */
@Module({
  controllers: [AuthController],
  providers: [
    // Both adapters are constructed; the provider below picks one at startup
    // depending on whether DATABASE_URL is configured.
    InMemoryUserRepository,
    InMemoryRefreshTokenRepository,
    PostgresUserRepository,
    PostgresRefreshTokenRepository,
    repositoryProvider(USER_REPOSITORY, PostgresUserRepository, InMemoryUserRepository),
    repositoryProvider(
      REFRESH_TOKEN_REPOSITORY,
      PostgresRefreshTokenRepository,
      InMemoryRefreshTokenRepository,
    ),
    { provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher },
    { provide: REFRESH_TOKEN_CODEC, useClass: Sha256RefreshTokenCodec },
    { provide: TOKEN_ISSUER, useClass: JoseTokenIssuer },
    // Application
    SessionManager,
    RegisterUserUseCase,
    LoginUseCase,
    RefreshSessionUseCase,
    RevokeSessionUseCase,
    GetCurrentUserUseCase,
    // Guards (reusable by other contexts)
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [TOKEN_ISSUER, JwtAuthGuard, RolesGuard],
})
export class IdentityModule {}
