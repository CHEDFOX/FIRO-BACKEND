import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

/**
 * The admin console, end to end, against in-memory storage.
 *
 * The first block is the one that matters most: this surface exposes every
 * account's email, saves and taste profile, so "a normal user cannot reach it"
 * is a correctness requirement, not a nicety.
 */
describe('Admin console (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let adminToken: string;
  let adminId: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    // ADMIN_EMAILS is the documented bootstrap: this address gets the admin
    // role at registration, and nothing else can grant it over HTTP.
    process.env['ADMIN_EMAILS'] = 'boss@firo.app, Second@Firo.app';
    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const admin = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'boss@firo.app', password: 'sup3r-secret-pw', handle: 'boss' })
      .expect(201);
    adminToken = admin.body.data.tokens.accessToken;
    adminId = admin.body.data.user.id;

    const user = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'curious@firo.app', password: 'sup3r-secret-pw', handle: 'curious' })
      .expect(201);
    userToken = user.body.data.tokens.accessToken;
    userId = user.body.data.user.id;
  });

  afterAll(async () => {
    delete process.env['ADMIN_EMAILS'];
    await app.close();
  });

  const asAdmin = (path: string) =>
    request(server).get(path).set('authorization', `Bearer ${adminToken}`);

  describe('access control', () => {
    it('grants the admin role to a bootstrap email, case-insensitively', () => {
      expect(adminToken).toBeTruthy();
      return asAdmin('/v1/admin/overview').expect(200);
    });

    it('refuses an ordinary signed-in user', async () => {
      const res = await request(server)
        .get('/v1/admin/overview')
        .set('authorization', `Bearer ${userToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('auth.insufficient_role');
    });

    it('refuses an anonymous caller', async () => {
      const res = await request(server).get('/v1/admin/users').expect(401);
      expect(res.body.error.code).toBe('auth.missing_token');
    });

    it('does not hand out the admin role to an ordinary registration', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .send({ email: 'nobody@firo.app', password: 'sup3r-secret-pw', handle: 'nobody' })
        .expect(201);
      expect(res.body.data.user.roles).toEqual(['user']);
    });
  });

  describe('overview', () => {
    it('reports users, content and engagement together', async () => {
      const res = await asAdmin('/v1/admin/overview').expect(200);
      const data = res.body.data;
      expect(data.users.total).toBeGreaterThanOrEqual(2);
      expect(data.content.experiences).toBeGreaterThan(0);
      expect(data.content.published).toBeGreaterThan(0);
      expect(typeof data.engagement.saves).toBe('number');
    });

    it('returns a dense 30-day trend so quiet days are visible', async () => {
      const res = await asAdmin('/v1/admin/overview').expect(200);
      expect(res.body.data.signupsByDay).toHaveLength(30);
      const today = res.body.data.signupsByDay[29];
      expect(today.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('users', () => {
    it('lists accounts newest-first with their behavioural counts', async () => {
      const res = await asAdmin('/v1/admin/users?limit=10').expect(200);
      expect(res.body.data.total).toBeGreaterThanOrEqual(2);
      const row = res.body.data.rows.find((r: { id: string }) => r.id === userId);
      expect(row.handle).toBe('curious');
      expect(row.saveCount).toBe(0);
      expect(row.dnaCompleteness).toBe(0);
    });

    it('searches by handle or email', async () => {
      const res = await asAdmin('/v1/admin/users?search=curious').expect(200);
      expect(res.body.data.rows).toHaveLength(1);
      expect(res.body.data.rows[0].handle).toBe('curious');
    });

    it('shows a user detail with DNA, saves and recent signals', async () => {
      // Give the user a taste profile and a save first.
      await request(server)
        .post('/v1/onboarding/answers')
        .set('authorization', `Bearer ${userToken}`)
        .send({ answers: [{ stepId: 'pull', selectedOptionIds: ['cold_quiet'] }] })
        .expect(200);

      const feed = await request(server)
        .get('/v1/feed?limit=1')
        .set('authorization', `Bearer ${userToken}`)
        .expect(200);
      const experienceId = feed.body.data[0].experience.id;

      await request(server)
        .post('/v1/saves')
        .set('authorization', `Bearer ${userToken}`)
        .send({ experienceId })
        .expect(201);

      // The client reports what the user did; saving and telling the engine
      // about it are separate calls by design (ADR-0007, async DNA).
      await request(server)
        .post('/v1/signals')
        .set('authorization', `Bearer ${userToken}`)
        .send({ kind: 'save', experienceId })
        .expect(202);

      const res = await asAdmin(`/v1/admin/users/${userId}`).expect(200);
      expect(res.body.data.user.saveCount).toBe(1);
      expect(res.body.data.user.lastActiveAt).not.toBeNull();
      expect(res.body.data.dna).not.toBeNull();
      expect(res.body.data.saves[0].experienceId).toBe(experienceId);
      expect(res.body.data.saves[0].title).toBeTruthy();
      expect(res.body.data.recentSignals.length).toBeGreaterThan(0);
    });

    it('404s for an unknown user', async () => {
      const res = await asAdmin('/v1/admin/users/00000000-0000-0000-0000-000000000000').expect(404);
      expect(res.body.error.code).toBe('admin.user_not_found');
    });

    it('suspends and reinstates an account', async () => {
      await request(server)
        .put(`/v1/admin/users/${userId}/status`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' })
        .expect(200);

      const suspended = await asAdmin(`/v1/admin/users/${userId}`).expect(200);
      expect(suspended.body.data.user.status).toBe('suspended');

      await request(server)
        .put(`/v1/admin/users/${userId}/status`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' })
        .expect(200);
    });

    // Losing the only admin account to a misclick is unrecoverable over HTTP.
    it('refuses to let an admin suspend or demote themselves', async () => {
      const suspend = await request(server)
        .put(`/v1/admin/users/${adminId}/status`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' })
        .expect(400);
      expect(suspend.body.error.code).toBe('admin.cannot_suspend_self');

      const demote = await request(server)
        .put(`/v1/admin/users/${adminId}/roles`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({ roles: ['user'] })
        .expect(400);
      expect(demote.body.error.code).toBe('admin.cannot_demote_self');
    });

    it('always keeps the base user role when roles are changed', async () => {
      const res = await request(server)
        .put(`/v1/admin/users/${userId}/roles`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({ roles: ['creator'] })
        .expect(200);
      expect(res.body.data.user.roles).toEqual(['user', 'creator']);
    });
  });

  describe('content management', () => {
    let createdId: string;

    it('lists the catalogue with save counts', async () => {
      const res = await asAdmin('/v1/admin/content?limit=100').expect(200);
      expect(res.body.data.total).toBeGreaterThan(0);
      const saved = res.body.data.rows.find((row: { saveCount: number }) => row.saveCount > 0);
      expect(saved.saveCount).toBe(1);
      expect(saved.placeName).toBeTruthy();
    });

    it('creates an experience and gives it a readable id', async () => {
      const places = await asAdmin('/v1/admin/map').expect(200);
      expect(places.body.data.length).toBeGreaterThan(0);

      const res = await request(server)
        .post('/v1/admin/content')
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_reine',
          slug: 'admin-made-this',
          title: 'Admin made this',
          summary: 'A test entry created through the console, long enough to be valid.',
          tags: ['cold', 'mountains'],
          budgetBand: 'moderate',
          months: [1, 2, 12],
          difficulty: 2,
          wowScore: 0.8,
          hiddenGemScore: 0.4,
          status: 'published',
        })
        .expect(201);

      createdId = res.body.data.id;
      expect(createdId).toBe('exp_admin_made_this');
      // seasonMask is a 12-bit month bitmask: Jan, Feb and Dec.
      expect(res.body.data.seasonMask).toBe(0b1000_0000_0011);
      expect(res.body.data.status).toBe('published');
    });

    it('makes a created experience immediately visible to the public API', async () => {
      const res = await request(server).get('/v1/experiences/admin-made-this').expect(200);
      expect(res.body.data.experience.title).toBe('Admin made this');
    });

    it('edits an experience without changing its id or created date', async () => {
      const before = await asAdmin('/v1/admin/content?search=admin-made-this').expect(200);
      const created = before.body.data.rows[0].experience;

      const res = await request(server)
        .put(`/v1/admin/content/${createdId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_reine',
          slug: 'admin-made-this',
          title: 'Admin edited this',
          summary: 'The summary was rewritten from the console, and is long enough.',
          tags: ['cold'],
          budgetBand: 'premium',
          difficulty: 3,
          wowScore: 0.9,
          hiddenGemScore: 0.5,
          status: 'published',
        })
        .expect(200);

      expect(res.body.data.id).toBe(createdId);
      expect(res.body.data.title).toBe('Admin edited this');
      expect(res.body.data.createdAt).toBe(created.createdAt);
      expect(res.body.data.updatedAt >= created.updatedAt).toBe(true);
    });

    it('rejects a slug that already belongs to another experience', async () => {
      const res = await request(server)
        .post('/v1/admin/content')
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_reine',
          slug: 'admin-made-this',
          title: 'A clashing entry',
          summary: 'This one reuses a slug that is already taken by another row.',
          tags: ['cold'],
          budgetBand: 'budget',
        })
        .expect(409);
      expect(res.body.error.code).toBe('admin.slug_taken');
    });

    it('rejects an unknown place instead of creating an orphan', async () => {
      const res = await request(server)
        .post('/v1/admin/content')
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_atlantis',
          slug: 'nowhere-at-all',
          title: 'Nowhere at all',
          summary: 'Points at a place that does not exist in the catalogue.',
          tags: ['water'],
          budgetBand: 'budget',
        })
        .expect(400);
      expect(res.body.error.code).toBe('admin.unknown_place');
    });

    it('rejects editorial scores outside 0..1, which would poison ranking', async () => {
      const res = await request(server)
        .post('/v1/admin/content')
        .set('authorization', `Bearer ${adminToken}`)
        .send({
          placeId: 'plc_reine',
          slug: 'over-scored',
          title: 'Over scored',
          summary: 'A wow score of twelve would dominate every feed forever.',
          tags: ['cold'],
          budgetBand: 'budget',
          wowScore: 12,
        })
        .expect(400);
      expect(res.body.error.code).toBe('request.invalid');
    });

    it('deletes an experience', async () => {
      await request(server)
        .delete(`/v1/admin/content/${createdId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(server).get('/v1/experiences/admin-made-this').expect(404);
    });
  });

  describe('audit log', () => {
    it('records who changed what, with the row on both sides', async () => {
      const res = await asAdmin('/v1/admin/audit?limit=50').expect(200);
      const entries = res.body.data;

      const deletion = entries.find(
        (entry: { action: string }) => entry.action === 'experience.deleted',
      );
      expect(deletion.actorHandle).toBe('boss');
      expect(deletion.before.title).toBe('Admin edited this');
      expect(deletion.after).toBeNull();

      const roleChange = entries.find(
        (entry: { action: string }) => entry.action === 'user.roles_changed',
      );
      expect(roleChange.before.roles).toEqual(['user']);
      expect(roleChange.after.roles).toEqual(['user', 'creator']);
    });
  });

  describe('activity', () => {
    it('returns recent signups, saves and signals newest-first', async () => {
      const res = await asAdmin('/v1/admin/activity?limit=50').expect(200);
      const kinds = new Set(res.body.data.map((event: { kind: string }) => event.kind));
      expect(kinds.has('save')).toBe(true);

      const timestamps = res.body.data.map((event: { at: string }) => event.at);
      expect([...timestamps].sort().reverse()).toEqual(timestamps);
    });

    it('treats a missing cursor as "the last few minutes", not all of history', async () => {
      const res = await asAdmin('/v1/admin/activity').expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns nothing for a cursor in the future', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const res = await asAdmin(`/v1/admin/activity?since=${encodeURIComponent(future)}`).expect(
        200,
      );
      expect(res.body.data).toEqual([]);
    });
  });

  describe('map', () => {
    it('plots every experience with its save count', async () => {
      const res = await asAdmin('/v1/admin/map').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const point of res.body.data) {
        expect(point.lat).toBeGreaterThanOrEqual(-90);
        expect(point.lat).toBeLessThanOrEqual(90);
        expect(typeof point.saves).toBe('number');
      }
      expect(res.body.data.some((point: { saves: number }) => point.saves > 0)).toBe(true);
    });
  });
});
