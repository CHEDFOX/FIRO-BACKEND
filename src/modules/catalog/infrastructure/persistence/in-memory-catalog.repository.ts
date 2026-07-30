import { Injectable } from '@nestjs/common';
import { CatalogRepository, ExperienceQuery } from '../../domain/catalog.repository';
import { Experience, isPublished } from '../../domain/experience';
import { BoundingBox, containsPoint } from '../../domain/geo';
import { Country, Place, Region } from '../../domain/place';
import { isInSeason } from '../../domain/taxonomy';
import { SEED_COUNTRIES, SEED_EXPERIENCES, SEED_PLACES, SEED_REGIONS } from '../seed/seed-catalog';

/**
 * In-memory catalog, pre-loaded with the curated seed set.
 *
 * Implements the same port the Postgres/PostGIS adapter will implement, so the
 * swap is invisible to the application layer. Scans are linear, which is fine
 * for a seed catalogue and keeps the semantics obvious.
 */
@Injectable()
export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly experiences = new Map<string, Experience>();
  private readonly places = new Map<string, Place>();
  private readonly countries = new Map<string, Country>();
  private readonly regions = new Map<string, Region>();

  constructor() {
    for (const experience of SEED_EXPERIENCES) {
      this.experiences.set(experience.id, experience);
    }
    for (const place of SEED_PLACES) {
      this.places.set(place.id, place);
    }
    for (const country of SEED_COUNTRIES) {
      this.countries.set(country.id, country);
    }
    for (const region of SEED_REGIONS) {
      this.regions.set(region.id, region);
    }
  }

  async findExperienceById(id: string): Promise<Experience | null> {
    return this.experiences.get(id) ?? null;
  }

  async findExperienceBySlug(slug: string): Promise<Experience | null> {
    for (const experience of this.experiences.values()) {
      if (experience.slug === slug) {
        return experience;
      }
    }
    return null;
  }

  async findExperiencesByIds(ids: readonly string[]): Promise<Experience[]> {
    const found: Experience[] = [];
    for (const id of ids) {
      const experience = this.experiences.get(id);
      if (experience) {
        found.push(experience);
      }
    }
    return found;
  }

  async listExperiences(query: ExperienceQuery): Promise<Experience[]> {
    let rows = [...this.experiences.values()].filter(isPublished);

    if (query.tags && query.tags.length > 0) {
      const wanted = new Set<string>(query.tags);
      rows = rows.filter((row) => row.tags.some((tag) => wanted.has(tag)));
    }
    if (query.countryCode) {
      const country = await this.findCountryByCode(query.countryCode);
      if (!country) {
        return [];
      }
      const placeIds = new Set(
        [...this.places.values()].filter((p) => p.countryId === country.id).map((p) => p.id),
      );
      rows = rows.filter((row) => placeIds.has(row.placeId));
    }
    if (query.month !== undefined) {
      rows = rows.filter((row) => isInSeason(row.seasonMask, query.month as number));
    }

    // Stable id ordering makes the keyset cursor deterministic.
    rows.sort((a, b) => a.id.localeCompare(b.id));
    if (query.afterId) {
      const index = rows.findIndex((row) => row.id === query.afterId);
      rows = index >= 0 ? rows.slice(index + 1) : rows;
    }
    // Fetch one extra so the caller can detect another page.
    return rows.slice(0, query.limit + 1);
  }

  async withinBounds(bounds: BoundingBox, limit: number): Promise<Experience[]> {
    return [...this.experiences.values()]
      .filter(isPublished)
      .filter((experience) => containsPoint(bounds, experience.coordinates))
      .slice(0, limit);
  }

  async findPlaceById(id: string): Promise<Place | null> {
    return this.places.get(id) ?? null;
  }

  async findCountryById(id: string): Promise<Country | null> {
    return this.countries.get(id) ?? null;
  }

  async findCountryByCode(code: string): Promise<Country | null> {
    const target = code.toUpperCase();
    for (const country of this.countries.values()) {
      if (country.code === target) {
        return country;
      }
    }
    return null;
  }

  async findRegionById(id: string): Promise<Region | null> {
    return this.regions.get(id) ?? null;
  }

  async listCountries(): Promise<Country[]> {
    return [...this.countries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
