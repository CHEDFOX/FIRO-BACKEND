import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

describe('Catalog, Map & Saves (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const reg = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'explorer@firo.app', password: 'sup3r-secret-pw', handle: 'explorer' })
      .expect(201);
    token = reg.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('browsing (no account needed)', () => {
    it('lists published experiences with a pagination cursor', async () => {
      const res = await request(server).get('/v1/experiences?limit=3').expect(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.cursor.hasMore).toBe(true);
      expect(typeof res.body.meta.cursor.next).toBe('string');
      // editorial scores must not leak to clients
      expect(res.body.data[0].wowScore).toBeUndefined();
      expect(res.body.data[0].hiddenGemScore).toBeUndefined();
    });

    it('pages forward with the cursor without repeating items', async () => {
      const first = await request(server).get('/v1/experiences?limit=4').expect(200);
      const second = await request(server)
        .get(`/v1/experiences?limit=4&cursor=${encodeURIComponent(first.body.meta.cursor.next)}`)
        .expect(200);

      const firstIds = first.body.data.map((e: { id: string }) => e.id);
      const secondIds = second.body.data.map((e: { id: string }) => e.id);
      expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
    });

    it('filters by tag', async () => {
      const res = await request(server).get('/v1/experiences?tags=desert').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const experience of res.body.data) {
        expect(experience.tags).toContain('desert');
      }
    });

    it('filters by country and by month', async () => {
      const norway = await request(server).get('/v1/experiences?country=NO').expect(200);
      expect(norway.body.data.length).toBeGreaterThan(0);

      const july = await request(server).get('/v1/experiences?month=7').expect(200);
      expect(july.body.data.length).toBeGreaterThan(0);
      // Lofoten's blue hour is a winter experience — not in July.
      const slugs = july.body.data.map((e: { slug: string }) => e.slug);
      expect(slugs).not.toContain('lofoten-blue-hour');
    });

    it('rejects an unknown tag with a validation error', async () => {
      const res = await request(server).get('/v1/experiences?tags=not_a_real_tag').expect(400);
      expect(res.body.error.code).toBe('request.invalid');
    });

    it('returns a full detail page by slug, with place and country', async () => {
      const res = await request(server).get('/v1/experiences/lofoten-blue-hour').expect(200);
      expect(res.body.data.experience.title).toBe('Lofoten in the blue hour');
      expect(res.body.data.place.name).toBe('Reine');
      expect(res.body.data.country.code).toBe('NO');
      expect(res.body.data.experience.coordinates.lat).toBeCloseTo(67.9333, 3);
    });

    it('404s an unknown experience', async () => {
      const res = await request(server).get('/v1/experiences/does-not-exist').expect(404);
      expect(res.body.error.code).toBe('catalog.experience_not_found');
    });
  });

  describe('map viewport', () => {
    it('returns clusters and pins for a viewport', async () => {
      const res = await request(server)
        .get('/v1/map?south=35&west=-10&north=71&east=40&zoom=3')
        .expect(200);
      expect(res.body.data.totalInView).toBeGreaterThan(0);
      expect(res.body.data.clusters.length).toBeGreaterThan(0);
      expect(res.body.data.pins.length).toBe(res.body.data.clusters.length);
      expect(res.body.data.truncated).toBe(false);
    });

    it('groups at low zoom and splits at high zoom', async () => {
      const bounds = 'south=66&west=11&north=69&east=15';
      const wide = await request(server).get(`/v1/map?${bounds}&zoom=2`).expect(200);
      const close = await request(server).get(`/v1/map?${bounds}&zoom=14`).expect(200);
      expect(close.body.data.clusters.length).toBeGreaterThanOrEqual(
        wide.body.data.clusters.length,
      );
      expect(wide.body.data.clusters[0].count).toBeGreaterThan(1);
    });

    it('rejects impossible bounds', async () => {
      const res = await request(server)
        .get('/v1/map?south=80&west=-10&north=10&east=40&zoom=3')
        .expect(400);
      expect(res.body.error.code).toBe('map.invalid_bounds');
    });

    it('requires a sign-in for the saved-only map', async () => {
      const res = await request(server)
        .get('/v1/map?south=-90&west=-180&north=90&east=180&zoom=1&saved=true')
        .expect(401);
      expect(res.body.error.code).toBe('auth.required_for_saved_map');
    });
  });

  describe('saving', () => {
    it('requires authentication', async () => {
      await request(server)
        .post('/v1/saves')
        .send({ experienceId: 'exp_lofoten_blue_hour' })
        .expect(401);
    });

    it('saves an experience into an auto-created default collection', async () => {
      const res = await request(server)
        .post('/v1/saves')
        .set('Authorization', `Bearer ${token}`)
        .send({ experienceId: 'exp_lofoten_blue_hour', note: 'winter trip?' })
        .expect(201);
      expect(res.body.data.saved).toBe(true);
      expect(res.body.data.created).toBe(true);
      expect(res.body.data.collection.name).toBe('Saved');
    });

    it('is idempotent — saving twice does not duplicate', async () => {
      const again = await request(server)
        .post('/v1/saves')
        .set('Authorization', `Bearer ${token}`)
        .send({ experienceId: 'exp_lofoten_blue_hour' })
        .expect(201);
      expect(again.body.data.created).toBe(false);

      const list = await request(server)
        .get('/v1/saves')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const matching = list.body.data.filter(
        (entry: { experience: { id: string } }) =>
          entry.experience.id === 'exp_lofoten_blue_hour',
      );
      expect(matching).toHaveLength(1);
    });

    it('404s when saving something that does not exist', async () => {
      const res = await request(server)
        .post('/v1/saves')
        .set('Authorization', `Bearer ${token}`)
        .send({ experienceId: 'exp_nope' })
        .expect(404);
      expect(res.body.error.code).toBe('catalog.experience_not_found');
    });

    it('shows only saved places on the personal map', async () => {
      await request(server)
        .post('/v1/saves')
        .set('Authorization', `Bearer ${token}`)
        .send({ experienceId: 'exp_erg_chebbi_silence' })
        .expect(201);

      const world = '/v1/map?south=-90&west=-180&north=90&east=180&zoom=1';
      const all = await request(server).get(world).expect(200);
      const mine = await request(server)
        .get(`${world}&saved=true`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(mine.body.data.totalInView).toBe(2);
      expect(mine.body.data.totalInView).toBeLessThan(all.body.data.totalInView);
    });

    it('unsaves, and is idempotent when repeated', async () => {
      const first = await request(server)
        .delete('/v1/saves/exp_erg_chebbi_silence')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(first.body.data.removed).toBe(true);

      const second = await request(server)
        .delete('/v1/saves/exp_erg_chebbi_silence')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(second.body.data.removed).toBe(false);
    });

    it("keeps one user's saves invisible to another", async () => {
      const other = await request(server)
        .post('/v1/auth/register')
        .send({ email: 'other@firo.app', password: 'sup3r-secret-pw', handle: 'other_user' })
        .expect(201);

      const res = await request(server)
        .get('/v1/saves')
        .set('Authorization', `Bearer ${other.body.data.tokens.accessToken}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
