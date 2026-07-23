import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { buildApp } from './bootstrap/app.factory';
import { APP_CONFIG, type AppConfig } from './bootstrap/config';

/**
 * HTTP entrypoint for the `api` process of the modular monolith.
 */
async function bootstrap(): Promise<void> {
  const app = await buildApp();
  const config = app.get<AppConfig>(APP_CONFIG);

  await app.listen(config.PORT, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(
    `${config.serviceName} v${config.serviceVersion} listening on :${config.PORT} (${config.NODE_ENV})`,
  );
}

bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
