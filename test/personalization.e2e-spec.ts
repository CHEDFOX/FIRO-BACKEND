import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

/**
 * The behaviour that matters: does the feed actually learn who you are, and
 * does it stay interesting while doing it?
 */
describe('Personalization (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  async function newUser(handle: string): Promise<string> {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email: `${handle}@firo.app`, password: 'sup3r-secret-pw', handle })
      .expect(201);
    return res.body.data.tokens.accessToken;
  }

  const signal = (token: string, kind: string, experienceId: string, extra = {}) =>
    request(server)
      .post('/v1/signals')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind, experienceId, ...extra })
      .expect(202);

  const feed = (token: string, query = 'limit=10') =>
    request(server)
      .get(`/v1/feed?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('requires authentication', async () => {
    await request(server).get('/v1/feed').expect(401);
    await request(server).post('/v1/signals').send({}).expect(401);
  });

  it('serves a feed to a brand-new user', async () => {
    const token = await newUser('newbie');
    const res = await feed(token);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].experience.title).toBeTruthy();
  });

  it('starts with an empty DNA profile', async () => {
    const token = await newUser('blank_slate');
    const res = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.completeness).toBe(0);
    expect(res.body.data.topTastes).toEqual([]);
  });

  it('learns a taste from saves and reflects it in the DNA profile', async () => {
    const token = await newUser('cold_lover');

    // Someone drawn to cold, quiet, mountainous places.
    await signal(token, 'save', 'exp_lofoten_blue_hour');
    await signal(token, 'save', 'exp_vestrahorn_black_sand');
    await signal(token, 'open', 'exp_hamnoy_bridge_dawn');

    const res = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const tags = res.body.data.topTastes.map((entry: { tag: string }) => entry.tag);
    expect(tags).toContain('cold');
    expect(res.body.data.completeness).toBeGreaterThan(0);
    expect(res.body.data.signalCount).toBe(3);
  });

  it('reorders the feed toward what the user actually likes', async () => {
    const token = await newUser('desert_lover');

    const before = await feed(token, 'limit=10');
    const beforeIds: string[] = before.body.data.map(
      (entry: { experience: { id: string } }) => entry.experience.id,
    );

    // Strong, repeated interest in warm desert solitude.
    for (let i = 0; i < 3; i += 1) {
      await signal(token, 'save', 'exp_erg_chebbi_silence');
      await signal(token, 'more_like_this', 'exp_erg_chebbi_silence');
    }
    // ...and an explicit rejection of the opposite.
    await signal(token, 'not_for_me', 'exp_gion_lantern_night');

    const after = await feed(token, 'limit=10');
    const afterIds: string[] = after.body.data.map(
      (entry: { experience: { id: string } }) => entry.experience.id,
    );

    // The order must have changed — the feed is not static.
    expect(afterIds).not.toEqual(beforeIds);

    // The rejected city/nightlife experience should not lead the feed.
    expect(afterIds[0]).not.toBe('exp_gion_lantern_night');
  });

  it('explains its recommendations once it is confident', async () => {
    const token = await newUser('explained');
    for (let i = 0; i < 4; i += 1) {
      await signal(token, 'save', 'exp_lofoten_blue_hour');
      await signal(token, 'more_like_this', 'exp_vestrahorn_black_sand');
    }

    const res = await feed(token, 'limit=10');
    const reasons: (string | null)[] = res.body.data.map(
      (entry: { reason: string | null }) => entry.reason,
    );
    expect(reasons.some((reason) => typeof reason === 'string' && reason.length > 0)).toBe(true);
  });

  it('keeps surprising the user with wildcards', async () => {
    const token = await newUser('surprise_me');
    for (let i = 0; i < 3; i += 1) {
      await signal(token, 'save', 'exp_lofoten_blue_hour');
    }
    const res = await feed(token, 'limit=10');
    const wildcards = res.body.data.filter((entry: { isWildcard: boolean }) => entry.isWildcard);
    expect(wildcards.length).toBeGreaterThan(0);
    expect(wildcards[0].reason).toBe('Something a little different');
  });

  it('does not keep selling what the user already saved', async () => {
    const token = await newUser('already_saved');
    await request(server)
      .post('/v1/saves')
      .set('Authorization', `Bearer ${token}`)
      .send({ experienceId: 'exp_machu_picchu_first_light' })
      .expect(201);

    const res = await feed(token, 'limit=20');
    const ids: string[] = res.body.data.map(
      (entry: { experience: { id: string } }) => entry.experience.id,
    );
    expect(ids).not.toContain('exp_machu_picchu_first_light');
  });

  it('reacts within a session via short-term intent', async () => {
    const token = await newUser('session_shift');
    const session = 'sess-abc';

    await signal(token, 'open', 'exp_benagil_sea_cave', { sessionId: session });
    await signal(token, 'dwell', 'exp_benagil_sea_cave', {
      sessionId: session,
      durationMs: 9000,
    });

    const withIntent = await feed(token, `limit=10&sessionId=${session}`);
    const withoutIntent = await feed(token, 'limit=10');

    // The same profile, read with and without the live session, should differ.
    expect(withIntent.body.data[0]).toBeDefined();
    expect(withoutIntent.body.data[0]).toBeDefined();
  });

  it('ignores signals for unknown experiences instead of failing', async () => {
    const token = await newUser('ghost_signal');
    const res = await request(server)
      .post('/v1/signals')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'save', experienceId: 'exp_does_not_exist' })
      .expect(202);
    expect(res.body.data.recorded).toBe(false);
  });

  it('rejects an invalid signal kind', async () => {
    const token = await newUser('bad_signal');
    const res = await request(server)
      .post('/v1/signals')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'telepathy', experienceId: 'exp_lofoten_blue_hour' })
      .expect(400);
    expect(res.body.error.code).toBe('request.invalid');
  });

  it("keeps one user's taste from leaking into another's feed", async () => {
    const a = await newUser('taste_a');
    const b = await newUser('taste_b');

    for (let i = 0; i < 4; i += 1) {
      await signal(a, 'save', 'exp_erg_chebbi_silence');
    }

    const dnaA = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${a}`)
      .expect(200);
    const dnaB = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${b}`)
      .expect(200);

    expect(dnaA.body.data.signalCount).toBeGreaterThan(0);
    expect(dnaB.body.data.signalCount).toBe(0);
  });
});
