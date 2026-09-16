import multipart from '@fastify/multipart';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { APP_CONFIG, type AppConfig } from './config';

/**
 * Builds and configures the Nest (Fastify) application without starting the
 * HTTP listener. Shared by the HTTP entrypoint (main.ts) and e2e tests so both
 * exercise the exact same wiring.
 *
 * - Fastify adapter (higher throughput/lower latency than Express).
 * - Global `/v1` API prefix; `health` is excluded (infra hits /health).
 * - Graceful shutdown hooks enabled.
 */
export async function buildApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: false,
  });

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      // Images are static assets served at the same path nginx will serve them
      // from. Versioning them would mean the URL stored in the database
      // changes the day a reverse proxy goes in front.
      { path: 'media/*', method: RequestMethod.GET },
    ],
  });

  // Multipart, for admin image uploads. Registered here rather than per-module
  // so the size limit is enforced by the parser — before a large body is in
  // memory — instead of after.
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.register(multipart, {
    limits: {
      fileSize: config.MEDIA_MAX_UPLOAD_BYTES,
      files: 1,
      fields: 8,
    },
  });

  // Browsers block cross-origin API calls unless the server opts in, so any
  // web client needs its origin allowed here.
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
    maxAge: 86_400,
  });

  app.enableShutdownHooks();

  return app;
}
