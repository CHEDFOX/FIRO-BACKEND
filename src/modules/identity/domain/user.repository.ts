import { User } from './user';

/**
 * Port for User persistence. The domain/application layers depend only on this
 * interface; infrastructure provides an implementation (in-memory now, Postgres
 * later) — the boundary that lets us wire a real database without touching
 * business logic.
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Case-insensitive email lookup. */
  findByEmail(email: string): Promise<User | null>;
  /** Case-insensitive handle lookup. */
  findByHandle(handle: string): Promise<User | null>;
  /** Insert or replace by id. */
  save(user: User): Promise<void>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
