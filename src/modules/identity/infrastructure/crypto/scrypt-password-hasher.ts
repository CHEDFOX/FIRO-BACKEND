import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PasswordHasher } from '../../domain/password-hasher';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 32;
const COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELIZATION = 1; // p

/**
 * scrypt-based password hasher (Node core, no native deps).
 * Format: `scrypt$<N>$<r>$<p>$<saltB64url>$<hashB64url>`.
 *
 * NOTE: argon2id is the production target (see docs). The PasswordHasher port
 * means switching the algorithm never touches domain/application code; the
 * format prefix lets us verify legacy hashes during a migration.
 */
@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(plain, salt, KEYLEN);
    return [
      'scrypt',
      COST,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    let derived: Buffer;
    try {
      derived = await scrypt(plain, salt, expected.length);
    } catch {
      return false;
    }
    if (derived.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(derived, expected);
  }
}
