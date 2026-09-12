import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';
import { Database } from '../src/infrastructure/database/database';

/**
 * Exercises the real Postgres adapters.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the default suite stays fast and
 * needs no services. CI and local runs with a database opt in:
 *
 *   TEST_DATABASE_URL=postgres://firo@127.0.0.1:5433/firo_test pnpm test
 *
 * The point is to catch what in-memory adapters cannot: real SQL, real
 * constraints, real type round-tripping (dates, bigints, JSONB, arrays).
 */
const CONNECTION = process.env['TEST_DATABASE_URL'];
const describeIfDb = CONNECTION ? describe : describe.skip;

describeIfDb('Postgres persistence (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let db: Database;

  const creds = {
    email: `pg_${Date.now()}@firo.app`,
    password: 'sup3r-secret-pw',
    handle: `pg_${Date.now()}`,
  };
  let token: string;
  let userId: string;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = CONNECTION;
    process.env['JWT_SECRET'] ??= 'postgres-test-secret-long-enough';

    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    db = new Database({ connectionString: CONNECTION as string });
  }, 30_000);

  afterAll(async () => {
    // Leave no test users behind; cascades clean up their DNA and saves.
    if (db && userId) {
      await db.query('DELETE FROM identity.users WHERE id = $1', [userId]).catch(() => undefined);
      await db.close();
    }
    await app?.close();
    delete process.env['DATABASE_URL'];
  });

  it('serves the seeded catalogue from the database', async () => {
    const res = await request(server).get('/v1/experiences?limit=5').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].title).toBeTruthy();
  });

  it('filters by tag using the SQL array overlap', async () => {
    const res = await request(server).get('/v1/experiences?tags=cold').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const experience of res.body.data) {
      expect(experience.tags).toContain('cold');
    }
  });

  it('filters by season using the bitmask test', async () => {
    const july = await request(server).get('/v1/experiences?month=7').expect(200);
    const slugs = july.body.data.map((e: { slug: string }) => e.slug);
    // Lofoten's blue hour is a winter experience.
    expect(slugs).not.toContain('lofoten-blue-hour');
  });

  it('registers a user that is really written to Postgres', async () => {
    const res = await request(server).post('/v1/auth/register').send(creds).expect(201);
    token = res.body.data.tokens.accessToken;
    userId = res.body.data.user.id;

    const row = await db.queryOne<{ email: string }>(
      'SELECT email FROM identity.users WHERE id = $1',
      [userId],
    );
    expect(row?.email).toBe(creds.email.toLowerCase());
  });

  it('rejects a duplicate email at the database level too', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ ...creds, handle: `${creds.handle}_2` })
      .expect(409);
    expect(res.body.error.code).toBe('identity.email_taken');
  });

  it('persists Explorer DNA as JSONB and reads it back intact', async () => {
    await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ stepId: 'pull', selectedOptionIds: ['cold_quiet', 'high_places'] }] })
      .expect(200);

    const row = await db.queryOne<{ dimensions: Record<string, unknown>; signal_count: number }>(
      'SELECT dimensions, signal_count FROM personalization.dna_profiles WHERE user_id = $1',
      [userId],
    );
    expect(row).not.toBeNull();
    expect(Object.keys(row?.dimensions ?? {}).length).toBeGreaterThan(0);

    const dna = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const tags = dna.body.data.topTastes.map((t: { tag: string }) => t.tag);
    expect(tags).toContain('cold');
  });

  it('saves a place, and the unique index makes a repeat save a no-op', async () => {
    await request(server)
      .post('/v1/saves')
      .set('Authorization', `Bearer ${token}`)
      .send({ experienceId: 'exp_lofoten_blue_hour' })
      .expect(201);

    await request(server)
      .post('/v1/saves')
      .set('Authorization', `Bearer ${token}`)
      .send({ experienceId: 'exp_lofoten_blue_hour' })
      .expect(201);

    const row = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.collection_items WHERE user_id = $1',
      [userId],
    );
    expect(row?.count).toBe('1');
  });

  it('creates exactly one default collection per user', async () => {
    const row = await db.queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM discovery.collections
       WHERE user_id = $1 AND is_default`,
      [userId],
    );
    expect(row?.count).toBe('1');
  });

  it('appends behavioural signals to the log', async () => {
    await request(server)
      .post('/v1/signals')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'open', experienceId: 'exp_vestrahorn_black_sand' })
      .expect(202);

    const row = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM personalization.signals WHERE user_id = $1',
      [userId],
    );
    expect(Number(row?.count)).toBeGreaterThan(0);
  });

  it('returns a personalised feed built from database reads', async () => {
    const res = await request(server)
      .get('/v1/feed?limit=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    // The saved place must not be sold back to the user.
    const ids = res.body.data.map((e: { experience: { id: string } }) => e.experience.id);
    expect(ids).not.toContain('exp_lofoten_blue_hour');
  });

  it('answers the map viewport query with clusters', async () => {
    const res = await request(server)
      .get('/v1/map?south=-90&west=-180&north=90&east=180&zoom=1')
      .expect(200);
    expect(res.body.data.totalInView).toBeGreaterThan(0);
    expect(res.body.data.clusters.length).toBeGreaterThan(0);
  });

  it('rotates refresh tokens and detects reuse against real rows', async () => {
    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    const refreshToken = login.body.data.tokens.refreshToken;

    await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(200);
    // The old token is now revoked; presenting it again is treated as theft.
    await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
  });
});
