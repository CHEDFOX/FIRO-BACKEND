import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';
import { Database } from '../src/infrastructure/database/database';
import { migrateDatabase, seedCatalog } from '../src/infrastructure/database/seed';

/**
 * The admin console against real SQL.
 *
 * The in-memory suite proves the console behaves; this proves the queries that
 * actually run in production are valid and return the same shapes. The two
 * adapters share only the domain's arithmetic, so everything else — the
 * cross-schema joins, the UNION ALL activity feed, the JSONB round-trip, the
 * audit log — exists in exactly one place and is only tested here.
 *
 *   TEST_DATABASE_URL=postgres://firo@127.0.0.1:5433/firo_test pnpm test
 */
const CONNECTION = process.env['TEST_DATABASE_URL'];
const describeIfDb = CONNECTION ? describe : describe.skip;

describeIfDb('Admin console over Postgres (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let db: Database;

  const stamp = Date.now();
  const adminEmail = `admin_${stamp}@firo.app`;
  const userEmail = `member_${stamp}@firo.app`;
  const createdSlug = `admin-pg-${stamp}`;

  let adminToken: string;
  let adminId: string;
  let userToken: string;
  let userId: string;
  let createdId: string;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = CONNECTION;
    process.env['JWT_SECRET'] ??= 'postgres-test-secret-long-enough';
    process.env['ADMIN_EMAILS'] = adminEmail;

    db = new Database({ connectionString: CONNECTION as string });
    await migrateDatabase(db);
    await seedCatalog(db);

    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const admin = await request(server)
      .post('/v1/auth/register')
      .send({ email: adminEmail, password: 'sup3r-secret-pw', handle: `admin_${stamp}` })
      .expect(201);
    adminToken = admin.body.data.tokens.accessToken;
    adminId = admin.body.data.user.id;

    const member = await request(server)
      .post('/v1/auth/register')
      .send({ email: userEmail, password: 'sup3r-secret-pw', handle: `member_${stamp}` })
      .expect(201);
    userToken = member.body.data.tokens.accessToken;
    userId = member.body.data.user.id;

    // Give the member a taste profile, a save and a signal so every aggregate
    // has something real to count.
    await request(server)
      .post('/v1/onboarding/answers')
      .set('authorization', `Bearer ${userToken}`)
      .send({ answers: [{ stepId: 'pull', selectedOptionIds: ['cold_quiet'] }] })
      .expect(200);
    await request(server)
      .post('/v1/saves')
      .set('authorization', `Bearer ${userToken}`)
      .send({ experienceId: 'exp_lofoten_blue_hour' })
      .expect(201);
    await request(server)
      .post('/v1/signals')
      .set('authorization', `Bearer ${userToken}`)
      .send({ kind: 'save', experienceId: 'exp_lofoten_blue_hour' })
      .expect(202);
  }, 45_000);

  afterAll(async () => {
    if (db) {
      // Cascades clean up DNA, saves, signals and audit entries.
      for (const id of [adminId, userId]) {
        if (id) {
          await db.query('DELETE FROM identity.users WHERE id = $1', [id]).catch(() => undefined);
        }
      }
      await db
        .query('DELETE FROM catalog.experiences WHERE slug = $1', [createdSlug])
        .catch(() => undefined);
      await db.close();
    }
    await app?.close();
    delete process.env['DATABASE_URL'];
    delete process.env['ADMIN_EMAILS'];
  });

  const asAdmin = (path: string) =>
    request(server).get(path).set('authorization', `Bearer ${adminToken}`);

  it('bootstraps the admin role from ADMIN_EMAILS into the real users table', async () => {
    const row = await db.queryOne<{ roles: string[] }>(
      'SELECT roles FROM identity.users WHERE id = $1',
      [adminId],
    );
    expect(row?.roles).toContain('admin');
  });

  it('still refuses an ordinary account', async () => {
    const res = await request(server)
      .get('/v1/admin/overview')
      .set('authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('auth.insufficient_role');
  });

  it('computes the overview across all four schemas in SQL', async () => {
    const res = await asAdmin('/v1/admin/overview').expect(200);
    const data = res.body.data;

    expect(data.users.total).toBeGreaterThanOrEqual(2);
    expect(data.users.newLast7d).toBeGreaterThanOrEqual(2);
    expect(data.users.activeLast7d).toBeGreaterThanOrEqual(1);
    expect(data.content.experiences).toBeGreaterThanOrEqual(10);
    expect(data.content.published).toBeGreaterThanOrEqual(10);
    expect(data.engagement.saves).toBeGreaterThanOrEqual(1);
    expect(data.engagement.dnaProfiles).toBeGreaterThanOrEqual(1);

    // Zero-filled and ending today, exactly as the in-memory adapter does.
    expect(data.signupsByDay).toHaveLength(30);
    expect(data.signupsByDay[29].day).toBe(new Date().toISOString().slice(0, 10));
    expect(data.signupsByDay[29].count).toBeGreaterThanOrEqual(2);

    expect(data.topTags.length).toBeGreaterThan(0);
    expect(data.topSaved.some((row: { title: string }) => row.title.length > 0)).toBe(true);
  });

  it('lists users with correlated counts and a real last-active time', async () => {
    const res = await asAdmin(`/v1/admin/users?search=member_${stamp}`).expect(200);
    expect(res.body.data.total).toBe(1);

    const row = res.body.data.rows[0];
    expect(row.id).toBe(userId);
    expect(row.saveCount).toBe(1);
    expect(row.signalCount).toBeGreaterThanOrEqual(1);
    expect(row.dnaCompleteness).toBeGreaterThan(0);
    expect(row.topTags.length).toBeGreaterThan(0);
    expect(Date.parse(row.lastActiveAt)).toBeGreaterThan(0);
  });

  it('filters users by role and status through SQL predicates', async () => {
    const admins = await asAdmin('/v1/admin/users?role=admin&limit=200').expect(200);
    expect(admins.body.data.rows.some((row: { id: string }) => row.id === adminId)).toBe(true);
    expect(
      admins.body.data.rows.every((row: { roles: string[] }) => row.roles.includes('admin')),
    ).toBe(true);

    const active = await asAdmin('/v1/admin/users?status=active&limit=200').expect(200);
    expect(active.body.data.rows.every((row: { status: string }) => row.status === 'active')).toBe(
      true,
    );
  });

  it('reads a JSONB taste profile back intact on the detail view', async () => {
    const res = await asAdmin(`/v1/admin/users/${userId}`).expect(200);

    expect(res.body.data.dna).not.toBeNull();
    expect(Object.keys(res.body.data.dna.dimensions).length).toBeGreaterThan(0);
    const cold = res.body.data.dna.dimensions.cold;
    expect(typeof cold.positive).toBe('number');
    expect(typeof cold.exposures).toBe('number');

    expect(res.body.data.saves[0].title).toBe('Lofoten in the blue hour');
    expect(res.body.data.saves[0].placeName).toBe('Reine');
    expect(res.body.data.recentSignals[0].title).toBe('Lofoten in the blue hour');
  });

  it('lists content with per-row save counts and the place join', async () => {
    const res = await asAdmin('/v1/admin/content?search=lofoten').expect(200);
    const row = res.body.data.rows.find(
      (candidate: { experience: { id: string } }) =>
        candidate.experience.id === 'exp_lofoten_blue_hour',
    );
    expect(row.experience.slug).toBe('lofoten-blue-hour');
    expect(row.placeName).toBe('Reine');
    expect(row.countryCode).toBe('NO');
    expect(row.saveCount).toBeGreaterThanOrEqual(1);
  });

  it('lists places with their country and experience counts', async () => {
    const res = await asAdmin('/v1/admin/places').expect(200);
    const reine = res.body.data.find((place: { id: string }) => place.id === 'plc_reine');
    expect(reine.name).toBe('Reine');
    expect(reine.countryCode).toBe('NO');
    expect(reine.experienceCount).toBeGreaterThanOrEqual(1);
  });

  it('writes an experience through the catalog writer and reads it back', async () => {
    const created = await request(server)
      .post('/v1/admin/content')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        placeId: 'plc_reine',
        slug: createdSlug,
        title: 'Written from the console',
        summary: 'A row created by the admin console, long enough to pass validation.',
        tags: ['cold', 'solitude'],
        budgetBand: 'moderate',
        months: [1, 2, 12],
        difficulty: 2,
        wowScore: 0.8,
        hiddenGemScore: 0.6,
        status: 'published',
      })
      .expect(201);
    createdId = created.body.data.id;

    const row = await db.queryOne<{
      title: string;
      tags: string[];
      season_mask: number;
      wow_score: number;
      status: string;
      media: unknown[];
    }>(
      `SELECT title, tags, season_mask, wow_score, status, media
       FROM catalog.experiences WHERE id = $1`,
      [createdId],
    );

    expect(row?.title).toBe('Written from the console');
    expect(row?.tags).toEqual(['cold', 'solitude']);
    expect(row?.season_mask).toBe(0b1000_0000_0011);
    expect(row?.wow_score).toBeCloseTo(0.8, 5);
    expect(row?.status).toBe('published');
    expect(row?.media).toEqual([]);

    // And it is immediately live on the public API, from the same table.
    const published = await request(server).get(`/v1/experiences/${createdSlug}`).expect(200);
    expect(published.body.data.experience.title).toBe('Written from the console');
  });

  it('edits that experience without moving its id or created date', async () => {
    const before = await db.queryOne<{ created_at: Date }>(
      'SELECT created_at FROM catalog.experiences WHERE id = $1',
      [createdId],
    );

    const res = await request(server)
      .put(`/v1/admin/content/${createdId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        placeId: 'plc_reine',
        slug: createdSlug,
        title: 'Edited from the console',
        summary: 'The summary was rewritten, and is still long enough to be valid.',
        tags: ['cold'],
        budgetBand: 'premium',
        difficulty: 3,
        wowScore: 0.9,
        hiddenGemScore: 0.5,
        status: 'draft',
      })
      .expect(200);

    expect(res.body.data.id).toBe(createdId);

    const after = await db.queryOne<{ title: string; status: string; created_at: Date }>(
      'SELECT title, status, created_at FROM catalog.experiences WHERE id = $1',
      [createdId],
    );
    expect(after?.title).toBe('Edited from the console');
    expect(after?.status).toBe('draft');
    expect(after?.created_at.toISOString()).toBe(before?.created_at.toISOString());

    // A draft disappears from the public API but stays in the console.
    await request(server).get(`/v1/experiences/${createdSlug}`).expect(404);
    const listed = await asAdmin(`/v1/admin/content?search=${createdSlug}`).expect(200);
    expect(listed.body.data.total).toBe(1);
  });

  it('records every change in admin.audit_log with both sides of the row', async () => {
    const rows = await db.query<{
      actor_handle: string;
      action: string;
      target_id: string;
      before: { title?: string } | null;
      after: { title?: string } | null;
    }>(
      `SELECT actor_handle, action, target_id, before, after
       FROM admin.audit_log WHERE target_id = $1 ORDER BY at ASC`,
      [createdId],
    );

    expect(rows.map((row) => row.action)).toEqual(['experience.created', 'experience.updated']);
    expect(rows[0]?.actor_handle).toBe(`admin_${stamp}`);
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.after?.title).toBe('Written from the console');
    expect(rows[1]?.before?.title).toBe('Written from the console');
    expect(rows[1]?.after?.title).toBe('Edited from the console');

    // And the same entries come back through the API.
    const res = await asAdmin('/v1/admin/audit?limit=50').expect(200);
    expect(
      res.body.data.some(
        (entry: { action: string; targetId: string }) =>
          entry.action === 'experience.updated' && entry.targetId === createdId,
      ),
    ).toBe(true);
  });

  it('merges signups, saves and signals into one ordered activity feed', async () => {
    const res = await asAdmin('/v1/admin/activity?limit=100').expect(200);
    const events = res.body.data;

    const kinds = new Set(events.map((event: { kind: string }) => event.kind));
    expect(kinds.has('signup')).toBe(true);
    expect(kinds.has('save')).toBe(true);
    expect(kinds.has('signal')).toBe(true);

    const timestamps = events.map((event: { at: string }) => event.at);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);

    const save = events.find((event: { kind: string }) => event.kind === 'save');
    expect(save.label).toContain('Lofoten');
    expect(save.handle).toBe(`member_${stamp}`);
  });

  it('honours the activity cursor', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await asAdmin(`/v1/admin/activity?since=${encodeURIComponent(future)}`).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('plots the map from the experiences table with save counts', async () => {
    const res = await asAdmin('/v1/admin/map').expect(200);
    const lofoten = res.body.data.find(
      (point: { experienceId: string }) => point.experienceId === 'exp_lofoten_blue_hour',
    );
    expect(lofoten.saves).toBeGreaterThanOrEqual(1);
    expect(lofoten.lat).toBeCloseTo(67.93, 1);
    expect(lofoten.tags).toContain('cold');
  });

  it('suspends an account in the real users table and bumps its version', async () => {
    const before = await db.queryOne<{ version: string }>(
      'SELECT version::text FROM identity.users WHERE id = $1',
      [userId],
    );

    await request(server)
      .put(`/v1/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ status: 'suspended' })
      .expect(200);

    const after = await db.queryOne<{ status: string; version: string }>(
      'SELECT status, version::text FROM identity.users WHERE id = $1',
      [userId],
    );
    expect(after?.status).toBe('suspended');
    expect(Number(after?.version)).toBe(Number(before?.version) + 1);

    await request(server)
      .put(`/v1/admin/users/${userId}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' })
      .expect(200);
  });

  it('hard-deletes an experience and cascades to the saves that referenced it', async () => {
    // The previous test left it as a draft, and drafts cannot be saved — which
    // is the correct behaviour, so republish it rather than weaken that rule.
    await request(server)
      .put(`/v1/admin/content/${createdId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        placeId: 'plc_reine',
        slug: createdSlug,
        title: 'Edited from the console',
        summary: 'The summary was rewritten, and is still long enough to be valid.',
        tags: ['cold'],
        budgetBand: 'premium',
        difficulty: 3,
        wowScore: 0.9,
        hiddenGemScore: 0.5,
        status: 'published',
      })
      .expect(200);

    await request(server)
      .post('/v1/saves')
      .set('authorization', `Bearer ${userToken}`)
      .send({ experienceId: createdId })
      .expect(201);

    const savedBefore = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.collection_items WHERE experience_id = $1',
      [createdId],
    );
    expect(Number(savedBefore?.count)).toBe(1);

    await request(server)
      .delete(`/v1/admin/content/${createdId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(204);

    const gone = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM catalog.experiences WHERE id = $1',
      [createdId],
    );
    expect(Number(gone?.count)).toBe(0);

    const savedAfter = await db.queryOne<{ count: string }>(
      'SELECT count(*)::text AS count FROM discovery.collection_items WHERE experience_id = $1',
      [createdId],
    );
    expect(Number(savedAfter?.count)).toBe(0);

    // The audit entry holds the only remaining copy of the deleted row.
    const audit = await db.queryOne<{ before: { title?: string } }>(
      `SELECT before FROM admin.audit_log
       WHERE target_id = $1 AND action = 'experience.deleted'`,
      [createdId],
    );
    expect(audit?.before?.title).toBe('Edited from the console');
  });
});
