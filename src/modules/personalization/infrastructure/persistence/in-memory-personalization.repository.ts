import { Injectable } from '@nestjs/common';
import { Tag } from '../../../catalog/domain/taxonomy';
import { DnaRepository } from '../../domain/dna.repository';
import { ExplorerDna } from '../../domain/explorer-dna';
import { SessionIntent, SessionIntentRepository } from '../../domain/session-intent';
import { Signal, SignalRepository } from '../../domain/signal';

@Injectable()
export class InMemoryDnaRepository implements DnaRepository {
  private readonly byUser = new Map<string, ExplorerDna>();

  async find(userId: string): Promise<ExplorerDna | null> {
    return this.byUser.get(userId) ?? null;
  }

  async save(dna: ExplorerDna): Promise<void> {
    this.byUser.set(dna.userId, dna);
  }

  /**
   * Average taste across everyone we know about, used to seed new profiles.
   * Withheld until a handful of profiles exist — an "average" drawn from two
   * users is noise, and seeding from noise is worse than seeding from nothing.
   */
  async populationPrior(): Promise<ReadonlyMap<Tag, number>> {
    const profiles = [...this.byUser.values()];
    if (profiles.length < 5) {
      return new Map();
    }
    const totals = new Map<Tag, number>();
    for (const profile of profiles) {
      for (const [tag, dimension] of Object.entries(profile.dimensions) as [
        Tag,
        { positive: number; negative: number },
      ][]) {
        const net = dimension.positive - dimension.negative;
        totals.set(tag, (totals.get(tag) ?? 0) + net);
      }
    }
    const prior = new Map<Tag, number>();
    for (const [tag, total] of totals) {
      const mean = total / profiles.length;
      // Normalise into a modest -1..1 so the prior nudges rather than dictates.
      prior.set(tag, Math.max(-1, Math.min(1, mean / 10)));
    }
    return prior;
  }
}

@Injectable()
export class InMemorySignalRepository implements SignalRepository {
  private readonly byUser = new Map<string, Signal[]>();

  async append(signal: Signal): Promise<void> {
    const existing = this.byUser.get(signal.userId) ?? [];
    existing.push(signal);
    this.byUser.set(signal.userId, existing);
  }

  async listForUser(userId: string, limit = 500): Promise<Signal[]> {
    const all = this.byUser.get(userId) ?? [];
    return all.slice(-limit).reverse();
  }

  async countForUser(userId: string): Promise<number> {
    return (this.byUser.get(userId) ?? []).length;
  }
}

@Injectable()
export class InMemorySessionIntentRepository implements SessionIntentRepository {
  private readonly byKey = new Map<string, SessionIntent>();

  async find(userId: string, sessionId: string): Promise<SessionIntent | null> {
    return this.byKey.get(`${userId}:${sessionId}`) ?? null;
  }

  async save(intent: SessionIntent): Promise<void> {
    this.byKey.set(`${intent.userId}:${intent.sessionId}`, intent);
  }
}
