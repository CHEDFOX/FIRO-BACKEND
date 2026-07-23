import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './bootstrap/config';

/**
 * Background `worker` process of the modular monolith. Built from the same
 * codebase as `api`, it runs queued jobs, event folding (Explorer DNA), and AI
 * enrichment — none of which belong on the HTTP request path. Job processors
 * are registered here in later phases; for now it boots the DI container so the
 * process shape and deployment path exist.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('Worker');
  logger.log(`${config.serviceName} worker v${config.serviceVersion} started (${config.NODE_ENV})`);

  // Job queues (BullMQ) and event consumers are wired here in later phases.
}

bootstrap().catch((error) => {
  console.error('Fatal error during worker bootstrap:', error);
  process.exit(1);
});
