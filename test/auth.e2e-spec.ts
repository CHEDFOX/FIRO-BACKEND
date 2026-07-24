import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;

  const creds = { email: 'alex@firo.app', password: 'sup3r-secret-pw', handle: 'alex' };

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user and returns an enveloped user + tokens', async () => {
    const res = await request(server).post('/v1/auth/register').send(creds).expect(201);
    expect(res.body.error).toBeNull();
    expect(res.body.data.user.email).toBe('alex@firo.app');
    expect(res.body.data.user.roles).toEqual(['user']);
    // never leak the password hash
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(typeof res.body.data.tokens.accessToken).toBe('string');
    expect(res.body.data.tokens.tokenType).toBe('Bearer');
  });

  it('rejects an invalid registration body with a 400 validation envelope', async () => {
    const res = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', handle: 'a' })
      .expect(400);
    expect(res.body.error.code).toBe('request.invalid');
    expect(res.body.error.details.fields.length).toBeGreaterThan(0);
  });

  it('authenticates GET /v1/auth/me with the access token', async () => {
    const reg = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'me@firo.app', password: 'sup3r-secret-pw', handle: 'me_user' })
      .expect(201);
    const token = reg.body.data.tokens.accessToken;

    const me = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.data.email).toBe('me@firo.app');
  });

  it('rejects GET /v1/auth/me without a token (401 envelope)', async () => {
    const res = await request(server).get('/v1/auth/me').expect(401);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('auth.missing_token');
  });

  it('logs in and refreshes the session', async () => {
    await request(server)
      .post('/v1/auth/register')
      .send({ email: 'login@firo.app', password: 'sup3r-secret-pw', handle: 'login_user' })
      .expect(201);

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'login@firo.app', password: 'sup3r-secret-pw' })
      .expect(200);
    const refreshToken = login.body.data.tokens.refreshToken;

    const refreshed = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(refreshed.body.data.tokens.refreshToken).not.toBe(refreshToken);

    // reusing the old refresh token is rejected
    await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('rejects login with the wrong password (401)', async () => {
    await request(server)
      .post('/v1/auth/register')
      .send({ email: 'wrongpw@firo.app', password: 'sup3r-secret-pw', handle: 'wrongpw' })
      .expect(201);
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'wrongpw@firo.app', password: 'nope-nope-nope' })
      .expect(401);
    expect(res.body.error.code).toBe('auth.invalid_credentials');
  });
});
