import { Inject, Injectable } from '@nestjs/common';
import { buildPage, Page } from '../../../shared/pagination/cursor';
import { CATALOG_REPOSITORY, CatalogRepository } from '../domain/catalog.repository';
import { Experience } from '../domain/experience';
import { Tag } from '../domain/taxonomy';

export interface BrowseExperiencesQuery {
  readonly tags?: Tag[];
  readonly countryCode?: string;
  readonly month?: number;
  readonly limit: number;
  readonly afterId?: string;
}

@Injectable()
export class BrowseExperiencesUseCase {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  async execute(query: BrowseExperiencesQuery): Promise<Page<Experience>> {
    // The repository returns limit + 1 rows so we can detect a further page.
    const rows = await this.catalog.listExperiences(query);
    return buildPage(rows, query.limit, (last) => ({ afterId: last.id }));
  }
}
