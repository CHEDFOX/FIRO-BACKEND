import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiEnvelope, envelopeOk } from '../../../../shared/http/api-envelope';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { decodeCursor } from '../../../../shared/pagination/cursor';
import { Public } from '../../../identity/infrastructure/http/decorators';
import { BrowseExperiencesUseCase } from '../../application/browse-experiences.usecase';
import { GetExperienceUseCase } from '../../application/get-experience.usecase';
import { CATALOG_REPOSITORY, CatalogRepository } from '../../domain/catalog.repository';
import { PublicExperience, toPublicExperience } from '../../domain/experience';
import { Tag } from '../../domain/taxonomy';
import { Inject } from '@nestjs/common';
import { BrowseExperiencesQueryInput, BrowseExperiencesQuerySchema } from './catalog.dto';

/**
 * Public catalog browsing. Discovery must work before sign-up — "inspire first"
 * means a curious visitor can look around without an account.
 */
@Controller('experiences')
export class CatalogController {
  constructor(
    private readonly browse: BrowseExperiencesUseCase,
    private readonly getExperience: GetExperienceUseCase,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  @Get()
  @Public()
  async list(
    @Query(new ZodValidationPipe(BrowseExperiencesQuerySchema)) query: BrowseExperiencesQueryInput,
  ): Promise<ApiEnvelope<PublicExperience[]>> {
    const afterId = query.cursor
      ? decodeCursor<{ afterId?: string }>(query.cursor).afterId
      : undefined;

    const page = await this.browse.execute({
      tags: query.tags as Tag[] | undefined,
      countryCode: query.country,
      month: query.month,
      limit: query.limit,
      afterId,
    });

    return envelopeOk(page.items.map(toPublicExperience), {
      requestId: '', // backfilled by ResponseEnvelopeInterceptor
      cursor: { next: page.next, hasMore: page.hasMore },
    });
  }

  @Get('countries')
  @Public()
  async countries() {
    return this.catalog.listCountries();
  }

  @Get(':idOrSlug')
  @Public()
  async detail(@Param('idOrSlug') idOrSlug: string) {
    const detail = await this.getExperience.execute(idOrSlug);
    return {
      experience: toPublicExperience(detail.experience),
      place: detail.place
        ? {
            id: detail.place.id,
            name: detail.place.name,
            coordinates: detail.place.coordinates,
            elevationMeters: detail.place.elevationMeters,
            timezone: detail.place.timezone,
          }
        : null,
      region: detail.region ? { id: detail.region.id, name: detail.region.name } : null,
      country: detail.country
        ? { id: detail.country.id, code: detail.country.code, name: detail.country.name }
        : null,
    };
  }
}
