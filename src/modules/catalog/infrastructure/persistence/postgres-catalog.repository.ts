import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { CatalogRepository, ExperienceQuery } from '../../domain/catalog.repository';
import type { Experience, ExperienceStatus, MediaRef } from '../../domain/experience';
import type { BoundingBox } from '../../domain/geo';
import { crossesAntimeridian } from '../../domain/geo';
import type { Country, Place, Region } from '../../domain/place';
import type { BudgetBand, Tag } from '../../domain/taxonomy';

interface ExperienceRow {
  id: string;
  place_id: string;
  slug: string;
  title: string;
  summary: string;
  story: string | null;
  lat: number;
  lng: number;
  tags: string[];
  budget_band: string;
  season_mask: number;
  difficulty: number;
  wow_score: number;
  hidden_gem_score: number;
  media: MediaRef[];
  status: string;
  created_at: Date;
  updated_at: Date;
}

function toExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    placeId: row.place_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    story: row.story,
    coordinates: { lat: row.lat, lng: row.lng },
    tags: row.tags as Tag[],
    budgetBand: row.budget_band as BudgetBand,
    seasonMask: row.season_mask,
    difficulty: row.difficulty,
    wowScore: row.wow_score,
    hiddenGemScore: row.hidden_gem_score,
    media: row.media ?? [],
    status: row.status as ExperienceStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const EXP_COLUMNS = `
  id, place_id, slug, title, summary, story, lat, lng, tags, budget_band,
  season_mask, difficulty, wow_score, hidden_gem_score, media, status,
  created_at, updated_at
`;

@Injectable()
export class PostgresCatalogRepository implements CatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findExperienceById(id: string): Promise<Experience | null> {
    const row = await this.db.queryOne<ExperienceRow>(
      `SELECT ${EXP_COLUMNS} FROM catalog.experiences WHERE id = $1`,
      [id],
    );
    return row ? toExperience(row) : null;
  }

  async findExperienceBySlug(slug: string): Promise<Experience | null> {
    const row = await this.db.queryOne<ExperienceRow>(
      `SELECT ${EXP_COLUMNS} FROM catalog.experiences WHERE slug = $1`,
      [slug],
    );
    return row ? toExperience(row) : null;
  }

  async findExperiencesByIds(ids: readonly string[]): Promise<Experience[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db.query<ExperienceRow>(
      `SELECT ${EXP_COLUMNS} FROM catalog.experiences WHERE id = ANY($1)`,
      [ids],
    );
    // Preserve the caller's order — saved lists are already sorted by recency.
    const byId = new Map(rows.map((row) => [row.id, toExperience(row)]));
    return ids.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
  }

  async listExperiences(query: ExperienceQuery): Promise<Experience[]> {
    const where: string[] = [`status = 'published'`];
    const params: unknown[] = [];

    if (query.tags && query.tags.length > 0) {
      params.push(query.tags);
      // && is "arrays overlap" — matches any of the requested tags, and uses
      // the GIN index.
      where.push(`tags && $${params.length}`);
    }
    if (query.countryCode) {
      params.push(query.countryCode.toUpperCase());
      where.push(`place_id IN (
        SELECT p.id FROM catalog.places p
        JOIN catalog.countries c ON c.id = p.country_id
        WHERE c.code = $${params.length}
      )`);
    }
    if (query.month !== undefined) {
      params.push(query.month - 1);
      // Bitmask test: is this month's bit set in season_mask?
      where.push(`(season_mask & (1 << $${params.length})) <> 0`);
    }
    if (query.afterId) {
      params.push(query.afterId);
      where.push(`id > $${params.length}`);
    }

    // Fetch one extra row so the caller can detect a further page.
    params.push(query.limit + 1);

    const rows = await this.db.query<ExperienceRow>(
      `SELECT ${EXP_COLUMNS} FROM catalog.experiences
       WHERE ${where.join(' AND ')}
       ORDER BY id
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(toExperience);
  }

  async withinBounds(bounds: BoundingBox, limit: number): Promise<Experience[]> {
    // A viewport spanning the antimeridian wraps, so longitude becomes an OR.
    const lngClause = crossesAntimeridian(bounds)
      ? '(lng >= $2 OR lng <= $3)'
      : '(lng >= $2 AND lng <= $3)';

    const rows = await this.db.query<ExperienceRow>(
      `SELECT ${EXP_COLUMNS} FROM catalog.experiences
       WHERE status = 'published'
         AND lat >= $1 AND lat <= $4
         AND ${lngClause}
       LIMIT $5`,
      [bounds.south, bounds.west, bounds.east, bounds.north, limit],
    );
    return rows.map(toExperience);
  }

  async findPlaceById(id: string): Promise<Place | null> {
    const row = await this.db.queryOne<{
      id: string;
      country_id: string;
      region_id: string | null;
      name: string;
      slug: string;
      lat: number;
      lng: number;
      elevation_meters: number | null;
      timezone: string | null;
    }>(
      `SELECT id, country_id, region_id, name, slug, lat, lng, elevation_meters, timezone
       FROM catalog.places WHERE id = $1`,
      [id],
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      countryId: row.country_id,
      regionId: row.region_id,
      name: row.name,
      slug: row.slug,
      coordinates: { lat: row.lat, lng: row.lng },
      elevationMeters: row.elevation_meters,
      timezone: row.timezone,
    };
  }

  async findCountryById(id: string): Promise<Country | null> {
    return this.db.queryOne<Country>(
      `SELECT id, code, name, slug FROM catalog.countries WHERE id = $1`,
      [id],
    );
  }

  async findCountryByCode(code: string): Promise<Country | null> {
    return this.db.queryOne<Country>(
      `SELECT id, code, name, slug FROM catalog.countries WHERE code = $1`,
      [code.toUpperCase()],
    );
  }

  async findRegionById(id: string): Promise<Region | null> {
    const row = await this.db.queryOne<{
      id: string;
      country_id: string;
      name: string;
      slug: string;
    }>(`SELECT id, country_id, name, slug FROM catalog.regions WHERE id = $1`, [id]);
    return row ? { id: row.id, countryId: row.country_id, name: row.name, slug: row.slug } : null;
  }

  async listCountries(): Promise<Country[]> {
    return this.db.query<Country>(
      `SELECT id, code, name, slug FROM catalog.countries ORDER BY name`,
    );
  }
}
