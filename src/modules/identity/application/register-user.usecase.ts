import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../shared/ids';
import { PASSWORD_HASHER, PasswordHasher } from '../domain/password-hasher';
import { Role } from '../domain/role';
import { User, UserStatus } from '../domain/user';
import { USER_REPOSITORY, UserRepository } from '../domain/user.repository';
import { AuthResult } from './auth-result';
import { SessionManager } from './session-manager';

export interface RegisterUserCommand {
  readonly email: string;
  readonly password: string;
  readonly handle: string;
  readonly displayName?: string;
  readonly locale?: string;
  readonly deviceId?: string;
}

@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionManager,
  ) {}

  async execute(command: RegisterUserCommand): Promise<AuthResult> {
    const email = command.email.trim().toLowerCase();
    const handle = command.handle.trim();

    if (await this.users.findByEmail(email)) {
      throw AppError.conflict('identity.email_taken', 'An account with this email already exists');
    }
    if (await this.users.findByHandle(handle)) {
      throw AppError.conflict('identity.handle_taken', 'This handle is already taken');
    }

    const now = new Date().toISOString();
    const user: User = {
      id: uuidv7(),
      handle,
      email,
      emailVerified: false,
      passwordHash: await this.hasher.hash(command.password),
      displayName: command.displayName?.trim() || null,
      locale: command.locale?.trim() || 'en',
      roles: [Role.USER],
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    await this.users.save(user);

    const tokens = await this.sessions.startSession(user, command.deviceId ?? null);
    return { user, tokens };
  }
}
