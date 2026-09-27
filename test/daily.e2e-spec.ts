import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';
import { GetTodayUseCase } from '../src/modules/personalization/application/daily.usecases';

/**
 * The daily ritual, end to end: a guest onboards before signing up, gets one
 * place a day that holds for the whole day, keeps it, sees the month and the
 * map, asks tomorrow for somewhere warm, and finally claims the account —
 * keeping everything, because the id never changes.
 *
 * Days are advanced through the real use case with an explicit clock (far in
 * the future, so they cannot collide with the real "today"), while everything
 * the client does goes over HTTP.
 */
describe('The daily ritual (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let guestToken: string;
  let guestId: string;

  const auth = () => ({ authorization: `Bearer ${guestToken}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('arriving as a guest', () => {
    it('starts a real account with no credentials on the first tap', async () => {
      const res = await request(server).post('/v1/auth/guest').send({}).expect(201);
      guestToken = res.body.data.tokens.accessToken;
      guestId = res.body.data.user.id;

      expect(res.body.data.user.isGuest).toBe(true);
      expect(res.body.data.user.email).toBeNull();
      expect(res.body.data.user.handle).toMatch(/^guest_[0-9a-f]{12}$/);
    });

    it('serves an onboarding flow with a colour for every choice', async () => {
      const res = await request(server).get('/v1/onboarding').expect(200);
      const options = res.body.data.steps.flatMap((step: { options: unknown[] }) => step.options);
      expect(options.length).toBeGreaterThan(8);
      for (const option of options) {
        expect(option.dominantColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
        // No photographs uploaded yet: an honest null, never a dead URL.
        expect(option.image).toBeNull();
        expect(option).not.toHaveProperty('imageUrl');
      }
    });

    it('lets a guest answer onboarding', async () => {
      const res = await request(server)
        .post('/v1/onboarding/answers')
        .set(auth())
        .send({
          answers: [
            { stepId: 'pull', selectedOptionIds: ['cold_quiet', 'high_places'] },
            { stepId: 'pace', selectedOptionIds: ['quiet_night'] },
          ],
        })
        .expect(200);
      expect(res.body.data.profile.topTastes.length).toBeGreaterThan(0);
    });
  });

  describe('today', () => {
    let first: { experience: { id: string } };

    it('gives one place, with a greeting, a reason and nothing to buy', async () => {
      const res = await request(server).get('/v1/today?tz=Europe/Oslo').set(auth()).expect(200);
      first = res.body.data;
      const today = res.body.data;

      expect(today.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(today.greeting).toMatch(/^Somewhere .+, today\.$/);
      // Clues come before the place and never give its name away.
      expect(today.clues.length).toBeGreaterThan(0);
      for (const clue of today.clues) {
        expect(clue).not.toContain(today.place.name);
      }
      expect(today.tomorrow).toMatch(/^Tomorrow/);
      expect(today.reason).toMatch(/^chosen because you keep choosing /);
      expect(today.place.name).toBeTruthy();
      expect(today.experience.bestSeason).toBeTruthy();
      expect(today.isFirstDay).toBe(true);
      expect(today.kept).toBe(false);
      // The product has no prices and no ratings; the payload should not carry
      // the editorial scores that could become one.
      expect(today.experience).not.toHaveProperty('wowScore');
      expect(today.experience).not.toHaveProperty('price');
    });

    it('holds for the whole day, however many times it is opened', async () => {
      for (let i = 0; i < 3; i += 1) {
        const res = await request(server).get('/v1/today?tz=Europe/Oslo').set(auth()).expect(200);
        expect(res.body.data.experience.id).toBe(first.experience.id);
      }
    });

    // Keeping changes the taste profile, which changes the ranking. It must
    // not change what is on screen.
    it('does not change when the user keeps it', async () => {
      await request(server)
        .post('/v1/saves')
        .set(auth())
        .send({ experienceId: first.experience.id })
        .expect(201);
      await request(server)
        .post('/v1/signals')
        .set(auth())
        .send({ kind: 'save', experienceId: first.experience.id })
        .expect(202);

      const res = await request(server).get('/v1/today?tz=Europe/Oslo').set(auth()).expect(200);
      expect(res.body.data.experience.id).toBe(first.experience.id);
      expect(res.body.data.kept).toBe(true);
    });

    it('refuses a time zone it does not know, and says how to fix it', async () => {
      const res = await request(server).get('/v1/today?tz=Mars/Olympus').set(auth()).expect(400);
      expect(JSON.stringify(res.body.error.details)).toContain('IANA');
    });

    it('is private to its user', async () => {
      await request(server).get('/v1/today').expect(401);
    });
  });

  describe('the days after', () => {
    const days = ['2031-01-05', '2031-01-06', '2031-01-07', '2031-01-08', '2031-01-09'];
    const seen: string[] = [];

    it('shows a different place each day, never a recent one', async () => {
      const today = app.get(GetTodayUseCase);
      for (const day of days) {
        const view = await today.execute({
          userId: guestId,
          timeZone: 'UTC',
          now: new Date(`${day}T07:30:00Z`),
        });
        expect(view.day).toBe(day);
        expect(view.timeOfDay).toBe('morning');
        seen.push(view.experience.id);
      }
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('draws the month as a quilt, with a sentence about it', async () => {
      const res = await request(server)
        .get('/v1/days?month=2031-01&tz=UTC')
        .set(auth())
        .expect(200);
      expect(res.body.data.days.map((cell: { day: string }) => cell.day)).toEqual(days);
      expect(res.body.data.days[0].title).toBeTruthy();
      // A place with no photograph yet is drawn from its tags in the client.
      expect(res.body.data.days[0].tags.length).toBeGreaterThan(0);
      expect(typeof res.body.data.insight).toBe('string');
      expect(res.body.data.insight.length).toBeGreaterThan(10);
    });

    it('rejects a malformed month', async () => {
      await request(server).get('/v1/days?month=2031-13').set(auth()).expect(400);
    });
  });

  describe('the world, and tomorrow', () => {
    it('puts what was kept on the map, and speaks about it', async () => {
      const res = await request(server).get('/v1/world').set(auth()).expect(200);
      const world = res.body.data;
      expect(world.places).toHaveLength(1);
      expect(world.places[0].lat).toBeGreaterThan(-90);
      expect(world.detail).toBe('1 kept · 1 country');
      expect(world.headline).toBeTruthy();
      expect(world.surpriseTomorrow).toBe(false);
    });

    it('keeps the promise of "somewhere warm" on the next new day', async () => {
      const put = await request(server)
        .put('/v1/tomorrow')
        .set(auth())
        .send({ surprise: true, toward: 'warm' })
        .expect(200);
      expect(put.body.data).toEqual({ surpriseTomorrow: true, toward: 'warm' });

      const view = await app.get(GetTodayUseCase).execute({
        userId: guestId,
        timeZone: 'UTC',
        now: new Date('2031-01-10T07:30:00Z'),
      });
      expect(view.experience.tags).toContain('warm');
      expect(view.isWildcard).toBe(true);
      expect(view.reason).toBe('somewhere warm, as you asked');

      // One-shot: it was for tomorrow, and tomorrow has happened.
      const world = await request(server).get('/v1/world').set(auth()).expect(200);
      expect(world.body.data.surpriseTomorrow).toBe(false);
    });
  });

  describe('rhythm', () => {
    it('defaults to no notifications at all', async () => {
      const res = await request(server).get('/v1/me/rhythm').set(auth()).expect(200);
      expect(res.body.data.mode).toBe('none');
      expect(res.body.data.notifyAt).toBeNull();
    });

    it('records when the daily note should arrive', async () => {
      const res = await request(server)
        .put('/v1/me/rhythm')
        .set(auth())
        .send({ mode: 'morning', tz: 'Europe/Oslo' })
        .expect(200);
      expect(res.body.data.mode).toBe('morning');
      expect(res.body.data.notifyAt).toBe('07:30');
      expect(res.body.data.timezone).toBe('Europe/Oslo');
    });

    it('rejects a time that is not a time', async () => {
      await request(server)
        .put('/v1/me/rhythm')
        .set(auth())
        .send({ mode: 'evening', time: '25:99' })
        .expect(400);
    });
  });

  describe('keeping the DNA', () => {
    let dnaBefore: unknown;
    let todayBefore: string;

    it('remembers the guest profile before claiming', async () => {
      dnaBefore = (await request(server).get('/v1/me/dna').set(auth()).expect(200)).body.data
        .topTastes;
      todayBefore = (await request(server).get('/v1/today?tz=Europe/Oslo').set(auth())).body.data
        .experience.id;
    });

    it('claims the account in place: same id, a handle from the email', async () => {
      const res = await request(server)
        .post('/v1/auth/claim')
        .set(auth())
        .send({ email: 'Wanderer@Firo.app', password: 'sup3r-secret-pw' })
        .expect(200);

      expect(res.body.data.user.id).toBe(guestId);
      expect(res.body.data.user.isGuest).toBe(false);
      expect(res.body.data.user.email).toBe('wanderer@firo.app');
      expect(res.body.data.user.handle).toBe('wanderer');
      guestToken = res.body.data.tokens.accessToken;
    });

    it('carries the taste profile, the keeps and today across untouched', async () => {
      const dna = await request(server).get('/v1/me/dna').set(auth()).expect(200);
      expect(dna.body.data.topTastes).toEqual(dnaBefore);

      const today = await request(server).get('/v1/today?tz=Europe/Oslo').set(auth()).expect(200);
      expect(today.body.data.experience.id).toBe(todayBefore);

      const world = await request(server).get('/v1/world').set(auth()).expect(200);
      expect(world.body.data.places.length).toBeGreaterThanOrEqual(1);
    });

    it('signs in with the new credentials to the same account', async () => {
      const res = await request(server)
        .post('/v1/auth/login')
        .send({ email: 'wanderer@firo.app', password: 'sup3r-secret-pw' })
        .expect(200);
      expect(res.body.data.user.id).toBe(guestId);
    });

    // A stolen access token must not be able to overwrite a real account's
    // email and password through the claim route.
    it('cannot be claimed twice', async () => {
      const res = await request(server)
        .post('/v1/auth/claim')
        .set(auth())
        .send({ email: 'someone-else@firo.app', password: 'sup3r-secret-pw' })
        .expect(409);
      expect(res.body.error.code).toBe('identity.already_claimed');
    });

    it('sends a guest with a taken email to sign in instead of merging', async () => {
      const other = await request(server).post('/v1/auth/guest').send({}).expect(201);
      const res = await request(server)
        .post('/v1/auth/claim')
        .set({ authorization: `Bearer ${other.body.data.tokens.accessToken}` })
        .send({ email: 'wanderer@firo.app', password: 'another-pass-word' })
        .expect(409);
      expect(res.body.error.code).toBe('identity.email_taken');
      expect(res.body.error.message).toContain('Sign in');
    });

    it('gives a second claimant with the same name a free handle', async () => {
      const other = await request(server).post('/v1/auth/guest').send({}).expect(201);
      const res = await request(server)
        .post('/v1/auth/claim')
        .set({ authorization: `Bearer ${other.body.data.tokens.accessToken}` })
        .send({ email: 'wanderer@elsewhere.org', password: 'another-pass-word' })
        .expect(200);
      expect(res.body.data.user.handle).toBe('wanderer2');
    });
  });

  describe('a guest who has not onboarded', () => {
    it('still gets a place, and is told it is a first guess', async () => {
      const guest = await request(server).post('/v1/auth/guest').send({}).expect(201);
      const res = await request(server)
        .get('/v1/today')
        .set({ authorization: `Bearer ${guest.body.data.tokens.accessToken}` })
        .expect(200);
      expect(res.body.data.reason).toContain('first guess');
    });
  });
});
