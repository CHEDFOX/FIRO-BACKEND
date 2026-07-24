import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshTokenCodec } from '../../domain/refresh-token';

/**
 * Generates 256-bit opaque refresh tokens and stores only their SHA-256 hash.
 * A fast hash is correct here: the token is already high-entropy, so there is
 * nothing to brute-force (unlike a password).
 */
@Injectable()
export class Sha256RefreshTokenCodec implements RefreshTokenCodec {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw).digest('base64url');
  }
}
