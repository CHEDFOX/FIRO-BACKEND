import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { PASSWORD_HASHER, PasswordHasher } from '../domain/password-hasher';
import { isActive } from '../domain/user';
import { USER_REPOSITORY, UserRepository } from '../domain/user.repository';
import { AuthResult } from './auth-result';
import { SessionManager } from './session-manager';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly deviceId?: string;
}

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionManager,
  ) {}

  async execute(command: LoginCommand): Promise<AuthResult> {
    const email = command.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    // Uniform error + a hash verification even when the user is missing, to
    // avoid leaking account existence via response timing/shape.
    const invalid = AppError.unauthenticated(
      'auth.invalid_credentials',
      'Invalid email or password',
    );

    if (!user || user.passwordHash === null) {
      await this.hasher.verify(command.password, DUMMY_HASH);
      throw invalid;
    }

    const ok = await this.hasher.verify(command.password, user.passwordHash);
    if (!ok) {
      throw invalid;
    }
    if (!isActive(user)) {
      throw AppError.forbidden('auth.account_inactive', 'Account is not active');
    }

    const tokens = await this.sessions.startSession(user, command.deviceId ?? null);
    return { user, tokens };
  }
}

// A well-formed scrypt hash of a random value, used only to equalize timing on
// the "user not found" path. Never matches a real password.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNoZmFrZWhhc2hmYWtlaGFzaGZha2U';
