import type { Server } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';
import { Database } from '../src/infrastructure/database/database';
import { migrateDatabase, seedCatalog } from '../src/infrastructure/database/seed';

/**
 * Media against real SQL.
 *
 * The in-memory suite proves the pipeline behaves. This proves the parts that
 * only exist in Postgres: the assets table, the JSONB variant round-trip, and
 * the `media @> …` containment query that decides whether an image is still in
 * use — which is the check standing between "delete" and "every card on the
 * site shows a broken image".
 *
 *   TEST_DATABASE_URL=postgres://firo@127.0.0.1:5433/firo_test pnpm test
 */
const CONNECTION = process.env['TEST_DATABASE_URL'];
const describeIfDb = CONNECTION ? describe : describe.skip;

describeIfDb('Media over Postgres (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let db: Database;
  let mediaDir: string;
  let adminToken: string;
  let adminId: string;

  const stamp = Date.now();
  const adminEmail = `media_pg_${stamp}@firo.app`;
  const slug = `photo-pg-${stamp}`;
  const SLOW = 30_000;

  async function photo(width: number, height: number): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        raw[index] = Math.min(255, 25 + (x / width) * 110 + Math.random() * 15);
        raw[index + 1] = Math.min(255, 55 + (y / height) * 95 + Math.random() * 15);
        raw[index + 2] = Math.min(255, 100 + (x / width) * 75 + Math.random() * 15);
      }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), 'firo-media-pg-'));
    process.env['DATABASE_URL'] = CONNECTION;
    process.env['JWT_SECRET'] ??= 'postgres-test-secret-long-enough';
    process.env['MEDIA_DIR'] = mediaDir;
    process.env['API_BASE_URL'] = 'http://127.0.0.1:3000';
    process.env['ADMIN_EMAILS'] = adminEmail;
    delete process.env['MEDIA_BASE_URL'];

    db = new Database({ connectionString: CONNECTION as string });
    await migrateDatabase(db);
    await seedCatalog(db);

    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const admin = await request(server)
      .post('/v1/auth/register')
      .send({ email: adminEmail, password: 'sup3r-secret-pw', handle: `media_pg_${stamp}` })
      .expect(201);
    adminToken = admin.body.data.tokens.accessToken;
    adminId = admin.body.data.user.id;
  }, 45_000);

  afterAll(async () => {
    if (db) {
      await db
        .query('DELETE FROM catalog.experiences WHERE slug = $1', [slug])
        .catch(() => undefined);
      if (adminId) {
        // Cascades remove the assets this admin uploaded.
        await db
          .query('DELETE FROM identity.users WHERE id = $1', [adminId])
          .catch(() => undefined);
      }
      await db.close();
    }
    await app?.close();
    await rm(mediaDir, { recursive: true, force: true });
    delete process.env['DATABASE_URL'];
    delete process.env['MEDIA_DIR'];
    delete process.env['ADMIN_EMAILS'];
    delete process.env['API_BASE_URL'];
  });

  const upload = (bytes: Buffer, filename = 'photo.jpg') =>
    request(server)
      .post('/v1/admin/media')
      .set('authorization', `Bearer ${adminToken}`)
      .attach('file', bytes, filename);

  let assetId: string;
  let mediaRef: {
    id: string;
    url: string;
    dominantColor: string;
    width: number;
    height: number;
    variants: { width: number; url: string }[];
  };

  it(
    'writes a real row, with the variant ladder as JSONB',
    async () => {
      const res = await upload(await photo(2400, 1600), 'stored.jpg').expect(201);
      mediaRef = res.body.data.media;
      assetId = res.body.data.asset.id;

      const row = await db.queryOne<{
        sha256: string;
        original_bytes: string;
        width: number;
        height: number;
        dominant_color: string;
        variants: { width: number; height: number; bytes: number; path: string }[];
        original_filename: string;
        uploaded_by: string;
      }>(
        `SELECT sha256, original_bytes::text, width, height, dominant_color, variants,
              original_filename, uploaded_by
       FROM media.assets WHERE id = $1`,
        [assetId],
      );

      expect(row?.sha256).toHaveLength(64);
      expect(row?.width).toBe(2400);
      expect(row?.dominant_color).toMatch(/^#[0-9a-f]{6}$/);
      expect(row?.original_filename).toBe('stored.jpg');
      expect(row?.uploaded_by).toBe(adminId);

      // JSONB round-trip: numbers come back as numbers, order preserved.
      expect(row?.variants.map((variant) => variant.width)).toEqual([400, 800, 1600]);
      for (const variant of row?.variants ?? []) {
        expect(typeof variant.bytes).toBe('number');
        expect(variant.path.endsWith('.webp')).toBe(true);
      }
    },
    SLOW,
  );

  it('enforces one row per distinct image at the database level', async () => {
    // The unique index on sha256 is what makes dedupe a guarantee rather than
    // a race that usually works.
    const duplicate = db.query(
      `INSERT INTO media.assets
         (id, sha256, original_content_type, original_bytes, original_path,
          width, height, dominant_color, variants, uploaded_by)
       SELECT gen_random_uuid(), sha256, original_content_type, original_bytes,
              original_path, width, height, dominant_color, variants, uploaded_by
       FROM media.assets WHERE id = $1`,
      [assetId],
    );
    await expect(duplicate).rejects.toThrow(/unique|duplicate/i);
  });

  it(
    'counts references with a JSONB containment query, not a guess',
    async () => {
      const before = await db.queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM catalog.experiences WHERE media @> $1::jsonb`,
        [JSON.stringify([{ id: assetId }])],
      );
      expect(Number(before?.count)).toBe(0);

      await request(server)
        .post('/v1/admin/content')
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_reine',
          slug,
          title: 'A card with a real photograph',
          summary: 'Stored in Postgres, with its variant ladder carried through intact.',
          tags: ['cold', 'photography'],
          budgetBand: 'moderate',
          status: 'published',
          media: [
            {
              id: mediaRef.id,
              url: mediaRef.url,
              dominantColor: mediaRef.dominantColor,
              width: mediaRef.width,
              height: mediaRef.height,
              attribution: null,
              alt: 'A stored photograph',
              variants: mediaRef.variants,
            },
          ],
        })
        .expect(201);

      const after = await db.queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM catalog.experiences WHERE media @> $1::jsonb`,
        [JSON.stringify([{ id: assetId }])],
      );
      expect(Number(after?.count)).toBe(1);
    },
    SLOW,
  );

  it('keeps the variants and alt text through the database, so srcset survives', async () => {
    // Dropping these on the way through is invisible until every phone starts
    // downloading the desktop-sized file.
    const res = await request(server).get(`/v1/experiences/${slug}`).expect(200);
    const ref = res.body.data.experience.media[0];

    expect(ref.alt).toBe('A stored photograph');
    expect(ref.variants).toHaveLength(3);
    expect(ref.variants.map((variant: { width: number }) => variant.width)).toEqual([
      400, 800, 1600,
    ]);
    for (const variant of ref.variants) {
      expect(variant.url.startsWith('http')).toBe(true);
    }
  });

  it('refuses to delete an image a published card is using', async () => {
    const res = await request(server)
      .delete(`/v1/admin/media/${assetId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(res.body.error.code).toBe('media.still_in_use');

    // And the row is untouched, not partially removed.
    const row = await db.queryOne<{ id: string }>('SELECT id FROM media.assets WHERE id = $1', [
      assetId,
    ]);
    expect(row?.id).toBe(assetId);
  });

  it('deletes the row and the files once nothing references it', async () => {
    await request(server)
      .delete(`/v1/admin/content/exp_${slug.replace(/-/g, '_')}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(server)
      .delete(`/v1/admin/media/${assetId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(204);

    const row = await db.queryOne<{ id: string }>('SELECT id FROM media.assets WHERE id = $1', [
      assetId,
    ]);
    expect(row).toBeNull();

    // Nothing left on disk for that hash either.
    const sha = mediaRef.url.split('/').pop()!.split('-')[0]!;
    const directory = join(mediaDir, sha.slice(0, 2), sha.slice(2, 4));
    const files = await readdir(directory).catch(() => []);
    expect(files.filter((file) => file.startsWith(sha))).toHaveLength(0);
  });

  it('shows in the console library, scoped to what exists', async () => {
    const res = await request(server)
      .get('/v1/admin/media?limit=50')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.rows.every((row: { id: string }) => row.id !== assetId)).toBe(true);
  });
});
