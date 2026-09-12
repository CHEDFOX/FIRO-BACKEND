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
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // Browsers block cross-origin API calls unless the server opts in, so any
  // web client needs its origin allowed here.
  const config = app.get<AppConfig>(APP_CONFIG);
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
