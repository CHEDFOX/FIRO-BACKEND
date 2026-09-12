import 'reflect-metadata';
import { join } from 'node:path';
import { loadConfig } from '../../bootstrap/config';
import {
  SEED_COUNTRIES,
  SEED_EXPERIENCES,
  SEED_PLACES,
  SEED_REGIONS,
} from '../../modules/catalog/infrastructure/seed/seed-catalog';
import { Database } from './database';
import { Migrator } from './migrator';

/**
 * Loads the curated catalogue into Postgres.
 *
 * Idempotent (upserts by id), so it is safe to re-run after editing the seed —
 * which is how catalogue content is updated until the CMS exists. It only ever
 * touches catalog.*, never user data.
 *
 *   pnpm seed
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — nothing to seed.');
  }

  const db = new Database({
    connectionString: config.DATABASE_URL,
    isProduction: config.isProduction,
  });

  try {
    const migrator = new Migrator(
      db,
      process.env['DB_MIGRATIONS_DIR'] ?? join(process.cwd(), 'db', 'migrations'),
    );
    const applied = await migrator.migrate();
    if (applied.length > 0) {
      console.log(`applied ${applied.length} migration(s)`);
    }

    // One transaction: a partial catalogue (places without their country) would
    // violate foreign keys and leave the database half-seeded.
    await db.transaction(async (client) => {
      for (const country of SEED_COUNTRIES) {
        await client.query(
          `INSERT INTO catalog.countries (id, code, name, slug) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, name=EXCLUDED.name, slug=EXCLUDED.slug`,
          [country.id, country.code, country.name, country.slug],
        );
      }

      for (const region of SEED_REGIONS) {
        await client.query(
          `INSERT INTO catalog.regions (id, country_id, name, slug) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET country_id=EXCLUDED.country_id, name=EXCLUDED.name, slug=EXCLUDED.slug`,
          [region.id, region.countryId, region.name, region.slug],
        );
      }

      for (const place of SEED_PLACES) {
        await client.query(
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

      for (const experience of SEED_EXPERIENCES) {
        await client.query(
          `INSERT INTO catalog.experiences
             (id, place_id, slug, title, summary, story, lat, lng, tags, budget_band,
              season_mask, difficulty, wow_score, hidden_gem_score, media, status,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             place_id=EXCLUDED.place_id, slug=EXCLUDED.slug, title=EXCLUDED.title,
             summary=EXCLUDED.summary, story=EXCLUDED.story, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
             tags=EXCLUDED.tags, budget_band=EXCLUDED.budget_band,
             season_mask=EXCLUDED.season_mask, difficulty=EXCLUDED.difficulty,
             wow_score=EXCLUDED.wow_score, hidden_gem_score=EXCLUDED.hidden_gem_score,
             media=EXCLUDED.media, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`,
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
    });

    const counts = await db.queryOne<{ countries: string; places: string; experiences: string }>(
      `SELECT
         (SELECT count(*) FROM catalog.countries)::text   AS countries,
         (SELECT count(*) FROM catalog.places)::text      AS places,
         (SELECT count(*) FROM catalog.experiences)::text AS experiences`,
    );
    console.log(
      `seeded: ${counts?.countries} countries, ${counts?.places} places, ${counts?.experiences} experiences`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
