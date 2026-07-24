import { Injectable } from '@nestjs/common';
import { User } from '../../domain/user';
import { UserRepository } from '../../domain/user.repository';

/**
 * In-memory UserRepository for the foundation phase and tests. Implements the
 * exact same port the Postgres adapter will implement later, so swapping in the
 * database requires no change to domain or application code.
 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    for (const user of this.byId.values()) {
      if (user.email !== null && user.email.toLowerCase() === target) {
        return user;
      }
    }
    return null;
  }

  async findByHandle(handle: string): Promise<User | null> {
    const target = handle.toLowerCase();
    for (const user of this.byId.values()) {
      if (user.handle.toLowerCase() === target) {
        return user;
      }
    }
    return null;
  }

  async save(user: User): Promise<void> {
    this.byId.set(user.id, user);
  }

  /** Test helper. */
  clear(): void {
    this.byId.clear();
  }
}
