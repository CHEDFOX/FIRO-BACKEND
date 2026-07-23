import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../bootstrap/config';

export interface ApiInfo {
  readonly name: string;
  readonly version: string;
  readonly apiVersion: 'v1';
  readonly docs: string;
}

/**
 * GET /v1/meta — a tiny enveloped endpoint that proves the standard response
 * pipeline end to end (global prefix + envelope interceptor). Returns basic API
 * build info.
 */
@Controller('meta')
export class MetaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  info(): ApiInfo {
    return {
      name: this.config.serviceName,
      version: this.config.serviceVersion,
      apiVersion: 'v1',
      docs: `${this.config.API_BASE_URL}/docs`,
    };
  }
}
