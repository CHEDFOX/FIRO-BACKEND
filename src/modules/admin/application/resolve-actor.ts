import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { USER_REPOSITORY, type UserRepository } from '../../identity/domain/user.repository';
import type { Actor } from './upsert-experience.usecase';

/**
 * Turns the JWT principal into the actor recorded in the audit log.
 *
 * The token carries only an id and roles; the log stores the handle as well,
 * denormalised, so an entry still reads sensibly years later even if the
 * account has since been renamed or deleted.
 */
@Injectable()
export class ResolveActor {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<Actor> {
    const user = await this.users.findById(userId);
    if (!user) {
      // A valid token for an account that no longer exists: the session should
      // not keep administrative power.
      throw AppError.unauthenticated('auth.unknown_actor', 'This account no longer exists');
    }
    return { id: user.id, handle: user.handle };
  }
}
