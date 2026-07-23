import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';

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

  app.enableShutdownHooks();

  return app;
}
