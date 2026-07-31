import { Inject, Injectable } from '@nestjs/common';
import { Tag } from '../../catalog/domain/taxonomy';
import { DNA_REPOSITORY, DnaRepository } from '../domain/dna.repository';
import {
  ExplorerDna,
  TasteSummary,
  completeness,
  dislikes,
  emptyDna,
  topTastes,
} from '../domain/explorer-dna';

export interface DnaProfileView {
  readonly topTastes: TasteSummary[];
  readonly dislikes: TasteSummary[];
  /** 0..1 — the "your Explorer DNA is 64% complete" number. */
  readonly completeness: number;
  readonly signalCount: number;
  readonly updatedAt: string;
}

/**
 * Reads the profile for display. Showing people their own evolving taste is a
 * genuine engagement loop in itself — self-discovery is a reason to come back,
 * and it only works because the model is interpretable.
 */
@Injectable()
export class GetDnaUseCase {
  constructor(@Inject(DNA_REPOSITORY) private readonly dnaRepo: DnaRepository) {}

  async execute(userId: string): Promise<DnaProfileView> {
    const dna = await this.load(userId);
    return {
      topTastes: topTastes(dna),
      dislikes: dislikes(dna),
      completeness: completeness(dna),
      signalCount: dna.signalCount,
      updatedAt: dna.updatedAt,
    };
  }

  /** Raw profile for internal use (ranking). */
  async load(userId: string): Promise<ExplorerDna> {
    return (await this.dnaRepo.find(userId)) ?? emptyDna(userId, new Date().toISOString());
  }

  async scoresByTag(userId: string): Promise<ReadonlyMap<Tag, number>> {
    const dna = await this.load(userId);
    const map = new Map<Tag, number>();
    for (const tag of Object.values(Tag)) {
      const dimension = dna.dimensions[tag];
      if (dimension) {
        map.set(tag, dimension.positive - dimension.negative);
      }
    }
    return map;
  }
}
