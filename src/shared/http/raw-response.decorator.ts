import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route handler as returning a raw response that must NOT be wrapped in
 * the standard API envelope (e.g. health checks for load balancers, media, or
 * streaming endpoints). Read by ResponseEnvelopeInterceptor.
 */
export const RAW_RESPONSE_KEY = 'firo:raw_response';

export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
