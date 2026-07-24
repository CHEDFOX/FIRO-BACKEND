import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { User } from '../domain/user';
import { USER_REPOSITORY, UserRepository } from '../domain/user.repository';

@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw AppError.notFound('identity.user_not_found', 'User not found');
    }
    return user;
  }
}
