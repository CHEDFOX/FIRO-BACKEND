import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { CATALOG_REPOSITORY, CatalogRepository } from '../domain/catalog.repository';
import { Experience, isPublished } from '../domain/experience';
import { Country, Place, Region } from '../domain/place';

export interface ExperienceDetail {
  readonly experience: Experience;
  readonly place: Place | null;
  readonly region: Region | null;
  readonly country: Country | null;
}

@Injectable()
export class GetExperienceUseCase {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  /** Accepts an id or a slug, so links can be human-readable. */
  async execute(idOrSlug: string): Promise<ExperienceDetail> {
    const experience =
      (await this.catalog.findExperienceById(idOrSlug)) ??
      (await this.catalog.findExperienceBySlug(idOrSlug));

    if (!experience || !isPublished(experience)) {
      throw AppError.notFound('catalog.experience_not_found', 'Experience not found', {
        idOrSlug,
      });
    }

    const place = await this.catalog.findPlaceById(experience.placeId);
    const region = place?.regionId ? await this.catalog.findRegionById(place.regionId) : null;
    const country = place ? await this.catalog.findCountryById(place.countryId) : null;

    return { experience, place, region, country };
  }
}
