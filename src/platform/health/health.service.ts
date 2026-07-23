import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../bootstrap/config';

export interface HealthReport {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
  readonly env: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

/**
 * Liveness/readiness reporting. In later phases this aggregates dependency
 * checks (Postgres, Redis, OpenSearch) into a readiness verdict; for now it
 * reports process liveness and build info.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  check(now: Date = new Date()): HealthReport {
    return {
      status: 'ok',
      service: this.config.serviceName,
      version: this.config.serviceVersion,
      env: this.config.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: now.toISOString(),
    };
  }
}
