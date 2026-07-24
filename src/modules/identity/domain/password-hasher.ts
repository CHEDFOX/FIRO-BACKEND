/**
 * Port for password hashing. Implemented with a slow KDF in infrastructure.
 * (Foundation uses scrypt from Node core; argon2id is the production target —
 * swapping is isolated to the adapter.)
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Constant-time verification. */
  verify(plain: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
