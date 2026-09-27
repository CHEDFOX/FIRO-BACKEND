import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../bootstrap/config';
import { AppError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../shared/ids';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';
import { Role } from '../domain/role';
import { isActive, type User, UserStatus } from '../domain/user';
import { USER_REPOSITORY, type UserRepository } from '../domain/user.repository';
import type { AuthResult } from './auth-result';
import { SessionManager } from './session-manager';

/**
 * Guests: an account before a sign-up.
 *
 * Firo shows a place before it asks for anything, so onboarding runs before
 * the user has an email address. The answers still need an owner, so the first
 * tap creates a guest — a real user row with no credentials — and every later
 * step (taste profile, keeps, the daily history) attaches to it normally.
 *
 * Claiming later writes email and password onto that SAME row. Nothing is
 * copied or merged, because nothing moves: the id is unchanged.
 */
@Injectable()
export class StartGuestSessionUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly sessions: SessionManager,
  ) {}

  async execute(input: { locale?: string; deviceId?: string }): Promise<AuthResult> {
    const now = new Date().toISOString();
    const user: User = {
      id: uuidv7(),
      // Handles are unique and required. A guest's is never shown to anyone;
      // the random tail makes a collision a non-event rather than a retry loop.
      handle: `guest_${randomBytes(6).toString('hex')}`,
      email: null,
      emailVerified: false,
      passwordHash: null,
      displayName: null,
      locale: input.locale?.trim() || 'en',
      roles: [Role.USER],
      status: UserStatus.ACTIVE,
      isGuest: true,
      createdAt: now,
      updatedAt: now,
      version: 0,
    };
    await this.users.save(user);

    const tokens = await this.sessions.startSession(user, input.deviceId ?? null);
    return { user, tokens };
  }
}

export interface ClaimAccountCommand {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  /** Optional: derived from the email when absent. */
  readonly handle?: string;
  readonly displayName?: string;
  readonly deviceId?: string;
}

@Injectable()
export class ClaimAccountUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly sessions: SessionManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(command: ClaimAccountCommand): Promise<AuthResult> {
    const user = await this.users.findById(command.userId);
    if (!user) {
      throw AppError.unauthenticated('auth.unknown_account', 'This session no longer exists');
    }
    if (!isActive(user)) {
      throw AppError.forbidden('auth.account_inactive', 'Account is not active');
    }
    if (!user.isGuest) {
      // Re-claiming would let a stolen access token silently replace a real
      // account's email and password.
      throw AppError.conflict(
        'identity.already_claimed',
        'This account already has a sign-in. Change your details from settings instead.',
      );
    }

    const email = command.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      // Not merged. A person who already has an account and onboarded again on
      // a new phone should sign in to it — their real history is there, and
      // blending in a few minutes of guest answers would dilute it.
      throw AppError.conflict(
        'identity.email_taken',
        'That email already has a Firo account. Sign in to it instead — your taste profile is waiting there.',
      );
    }

    const handle = command.handle?.trim() || (await this.freeHandleFrom(email));
    if (command.handle && (await this.users.findByHandle(handle))) {
      throw AppError.conflict('identity.handle_taken', 'This handle is already taken');
    }

    const now = new Date().toISOString();
    const roles = this.config.adminEmails.includes(email)
      ? [...new Set([...user.roles, Role.ADMIN])]
      : user.roles;

    const claimed: User = {
      ...user,
      handle,
      email,
      emailVerified: false,
      passwordHash: await this.hasher.hash(command.password),
      displayName: command.displayName?.trim() || user.displayName,
      roles,
      isGuest: false,
      updatedAt: now,
      version: user.version + 1,
    };
    await this.users.save(claimed);

    // A fresh session, because the roles may have changed and the client
    // should hold a token that says what the account now is.
    const tokens = await this.sessions.startSession(claimed, command.deviceId ?? null);
    return { user: claimed, tokens };
  }

  /**
   * A readable handle from the email's local part: "ada.lovelace@x" → "ada.lovelace",
   * then "ada.lovelace2" and so on if taken. People can change it later; what
   * matters now is that claiming never fails over a name they did not choose.
   */
  private async freeHandleFrom(email: string): Promise<string> {
    const local = email.split('@')[0] ?? 'explorer';
    const base = (local.replace(/[^a-zA-Z0-9_.]/g, '').slice(0, 24) || 'explorer').padEnd(3, '0');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
      if (!(await this.users.findByHandle(candidate))) {
        return candidate;
      }
    }
    return `${base}_${randomBytes(3).toString('hex')}`;
  }
}
