import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';

describe('API foundation (e2e)', () => {
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

  it('GET /health returns a raw (un-enveloped) liveness report', async () => {
    const res = await request(server).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('firo-backend');
    expect(res.body.version).toBe('0.1.0');
    // raw: not wrapped in the API envelope
    expect(res.body.data).toBeUndefined();
    expect(res.body.error).toBeUndefined();
  });

  it('GET /v1/meta returns an enveloped payload with a request id', async () => {
    const res = await request(server).get('/v1/meta').expect(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data.name).toBe('firo-backend');
    expect(res.body.data.apiVersion).toBe('v1');
    expect(typeof res.body.meta.requestId).toBe('string');
    expect(res.body.meta.requestId.length).toBeGreaterThan(0);
  });

  it('propagates an inbound x-request-id into the envelope meta', async () => {
    const res = await request(server)
      .get('/v1/meta')
      .set('x-request-id', 'req-test-123')
      .expect(200);
    expect(res.body.meta.requestId).toBe('req-test-123');
  });

  it('returns a standard error envelope for unknown routes', async () => {
    const res = await request(server).get('/v1/does-not-exist').expect(404);
    expect(res.body.data).toBeNull();
    expect(res.body.error).not.toBeNull();
    expect(res.body.error.retryable).toBe(false);
    expect(typeof res.body.error.code).toBe('string');
    expect(typeof res.body.meta.requestId).toBe('string');
  });
});
