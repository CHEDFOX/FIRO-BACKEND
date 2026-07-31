import { Tag } from '../../catalog/domain/taxonomy';
import { ExplorerDna } from './explorer-dna';

export interface DnaRepository {
  find(userId: string): Promise<ExplorerDna | null>;
  save(dna: ExplorerDna): Promise<void>;
  /**
   * Population-average taste, used to seed new profiles (empirical prior).
   * Returns an empty map until there is enough data to be meaningful.
   */
  populationPrior(): Promise<ReadonlyMap<Tag, number>>;
}

export const DNA_REPOSITORY = Symbol('DNA_REPOSITORY');
