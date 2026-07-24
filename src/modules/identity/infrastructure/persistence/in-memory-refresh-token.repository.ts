import { Injectable } from '@nestjs/common';
import { RefreshToken, RefreshTokenRepository } from '../../domain/refresh-token';

@Injectable()
export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byId = new Map<string, RefreshToken>();

  async create(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) {
        return token;
      }
    }
    return null;
  }

  async update(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
  }

  async revokeFamily(familyId: string, at: string): Promise<void> {
    for (const [id, token] of this.byId) {
      if (token.familyId === familyId && token.revokedAt === null) {
        this.byId.set(id, { ...token, revokedAt: at });
      }
    }
  }

  /** Test helper. */
  clear(): void {
    this.byId.clear();
  }
}
