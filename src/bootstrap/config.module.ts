import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';

/**
 * Provides the validated AppConfig application-wide. Global so any module can
 * inject `@Inject(APP_CONFIG)` without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
