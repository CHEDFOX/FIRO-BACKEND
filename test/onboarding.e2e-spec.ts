import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

describe('Onboarding (e2e)', () => {
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

  it('serves the onboarding flow without an account', async () => {
    const res = await request(server).get('/v1/onboarding').expect(200);
    expect(res.body.data.steps.length).toBeGreaterThan(0);
    const step = res.body.data.steps[0];
    expect(step.title).toBeTruthy();
    expect(step.options.length).toBeGreaterThan(1);
    expect(step.options[0].tags.length).toBeGreaterThan(0);
  });

  it('requires an account to submit answers', async () => {
    await request(server)
      .post('/v1/onboarding/answers')
      .send({ answers: [{ stepId: 'pull', selectedOptionIds: ['cold_quiet'] }] })
      .expect(401);
  });

  it('seeds a taste profile from the picks', async () => {
    const token = await newUser('onboarder');

    const res = await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        answers: [
          { stepId: 'pull', selectedOptionIds: ['cold_quiet', 'high_places'] },
          { stepId: 'pace', selectedOptionIds: ['quiet_night'] },
          { stepId: 'effort', selectedOptionIds: ['earn_it'] },
        ],
      })
      .expect(200);

    expect(res.body.data.seededTags).toBeGreaterThan(0);
    const tags = res.body.data.profile.topTastes.map((t: { tag: string }) => t.tag);
    expect(tags).toContain('solitude');
    expect(res.body.data.profile.completeness).toBeGreaterThan(0);
  });

  it('counts the road not taken in a forced choice', async () => {
    const token = await newUser('forced_choice');
    await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ stepId: 'pace', selectedOptionIds: ['quiet_night'] }] })
      .expect(200);

    const dna = await request(server)
      .get('/v1/me/dna')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Choosing the quiet evening is also evidence against the loud one.
    const disliked = dna.body.data.dislikes.map((d: { tag: string }) => d.tag);
    expect(disliked).toContain('nightlife');
  });

  it('personalises the very first feed from onboarding alone', async () => {
    const token = await newUser('first_feed');
    await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        answers: [
          { stepId: 'pull', selectedOptionIds: ['warm_water'] },
          { stepId: 'pace', selectedOptionIds: ['busy_night'] },
        ],
      })
      .expect(200);

    const feed = await request(server)
      .get('/v1/feed?limit=8')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(feed.body.data.length).toBeGreaterThan(0);
    // A warm-water leaning profile should get at least one explained pick.
    const reasons = feed.body.data.map((e: { reason: string | null }) => e.reason);
    expect(reasons.some((r: string | null) => typeof r === 'string')).toBe(true);
  });

  it('rejects unknown steps and options', async () => {
    const token = await newUser('bad_onboard');

    const badStep = await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ stepId: 'nope', selectedOptionIds: ['x'] }] })
      .expect(400);
    expect(badStep.body.error.code).toBe('onboarding.unknown_step');

    const badOption = await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ stepId: 'pull', selectedOptionIds: ['not_an_option'] }] })
      .expect(400);
    expect(badOption.body.error.code).toBe('onboarding.unknown_option');
  });

  it('requires the minimum number of selections', async () => {
    const token = await newUser('too_few');
    const res = await request(server)
      .post('/v1/onboarding/answers')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ stepId: 'pull', selectedOptionIds: [] }] })
      .expect(400);
    expect(res.body.error.code).toBe('onboarding.too_few_selections');
  });
});
