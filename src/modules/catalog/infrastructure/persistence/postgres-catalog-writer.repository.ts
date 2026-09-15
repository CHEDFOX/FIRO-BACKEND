import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { CatalogWriter } from '../../domain/catalog-writer';
import type { Experience } from '../../domain/experience';
import type { Place } from '../../domain/place';

@Injectable()
export class PostgresCatalogWriter implements CatalogWriter {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async upsertExperience(experience: Experience): Promise<void> {
    await this.db.query(
      `INSERT INTO catalog.experiences
         (id, place_id, slug, title, summary, story, lat, lng, tags, budget_band,
          season_mask, difficulty, wow_score, hidden_gem_score, media, status,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         place_id=EXCLUDED.place_id, slug=EXCLUDED.slug, title=EXCLUDED.title,
         summary=EXCLUDED.summary, story=EXCLUDED.story,
         lat=EXCLUDED.lat, lng=EXCLUDED.lng, tags=EXCLUDED.tags,
         budget_band=EXCLUDED.budget_band, season_mask=EXCLUDED.season_mask,
         difficulty=EXCLUDED.difficulty, wow_score=EXCLUDED.wow_score,
         hidden_gem_score=EXCLUDED.hidden_gem_score, media=EXCLUDED.media,
         status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
      [
        experience.id,
        experience.placeId,
        experience.slug,
        experience.title,
        experience.summary,
        experience.story,
        experience.coordinates.lat,
        experience.coordinates.lng,
        experience.tags,
        experience.budgetBand,
        experience.seasonMask,
        experience.difficulty,
        experience.wowScore,
        experience.hiddenGemScore,
        JSON.stringify(experience.media),
        experience.status,
        experience.createdAt,
        experience.updatedAt,
      ],
    );
  }

  async upsertPlace(place: Place): Promise<void> {
    await this.db.query(
      `INSERT INTO catalog.places
         (id, country_id, region_id, name, slug, lat, lng, elevation_meters, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         country_id=EXCLUDED.country_id, region_id=EXCLUDED.region_id,
         name=EXCLUDED.name, slug=EXCLUDED.slug, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
         elevation_meters=EXCLUDED.elevation_meters, timezone=EXCLUDED.timezone`,
      [
        place.id,
        place.countryId,
        place.regionId,
        place.name,
        place.slug,
        place.coordinates.lat,
        place.coordinates.lng,
        place.elevationMeters,
        place.timezone,
      ],
    );
  }

  async deleteExperience(id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM catalog.experiences WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
}
