import { Experience } from './experience';
import { BoundingBox } from './geo';
import { Country, Place, Region } from './place';
import { Tag } from './taxonomy';

export interface ExperienceQuery {
  readonly tags?: Tag[];
  readonly countryCode?: string;
  /** Only experiences at their best in this month (1-12). */
  readonly month?: number;
  readonly limit: number;
  /** Opaque keyset cursor: the id of the last item on the previous page. */
  readonly afterId?: string;
}

/**
 * Port for catalog reads. Implemented in-memory now; the Postgres adapter will
 * translate `withinBounds` into a PostGIS `ST_Intersects` query and the tag
 * filter into a GIN-indexed array containment check.
 */
export interface CatalogRepository {
  findExperienceById(id: string): Promise<Experience | null>;
  findExperienceBySlug(slug: string): Promise<Experience | null>;
  findExperiencesByIds(ids: readonly string[]): Promise<Experience[]>;
  /** Published experiences matching the query, id-ordered for stable keyset paging. */
  listExperiences(query: ExperienceQuery): Promise<Experience[]>;
  /** Published experiences whose coordinates fall inside a map viewport. */
  withinBounds(bounds: BoundingBox, limit: number): Promise<Experience[]>;

  findPlaceById(id: string): Promise<Place | null>;
  findCountryById(id: string): Promise<Country | null>;
  findCountryByCode(code: string): Promise<Country | null>;
  findRegionById(id: string): Promise<Region | null>;
  listCountries(): Promise<Country[]>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
