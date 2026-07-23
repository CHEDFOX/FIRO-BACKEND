import { Controller, Get } from '@nestjs/common';
import { RawResponse } from '../../shared/http/raw-response.decorator';
import { HealthReport, HealthService } from './health.service';

/**
 * GET /health — raw (un-enveloped) liveness endpoint for load balancers and
 * orchestrators. Excluded from the /v1 API prefix and from the response
 * envelope so infra tooling gets a plain, stable body.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @RawResponse()
  check(): HealthReport {
    return this.health.check();
  }
}
