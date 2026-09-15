import { Injectable } from '@nestjs/common';
import type { CatalogWriter } from '../../domain/catalog-writer';
import type { Experience } from '../../domain/experience';
import type { Place } from '../../domain/place';
import { InMemoryCatalogRepository } from './in-memory-catalog.repository';

/**
 * Writes into the same maps the in-memory reader serves from, so an edit made
 * with no DATABASE_URL is visible immediately — and lost on restart, which is
 * exactly what in-memory mode promises everywhere else.
 */
@Injectable()
export class InMemoryCatalogWriter implements CatalogWriter {
  constructor(private readonly catalog: InMemoryCatalogRepository) {}

  async upsertExperience(experience: Experience): Promise<void> {
    this.catalog.putExperience(experience);
  }

  async upsertPlace(place: Place): Promise<void> {
    this.catalog.putPlace(place);
  }

  async deleteExperience(id: string): Promise<boolean> {
    return this.catalog.dropExperience(id);
  }
}
