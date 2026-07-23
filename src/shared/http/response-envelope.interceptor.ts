import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiEnvelope, ApiMeta, envelopeOk, isApiEnvelope } from './api-envelope';
import { RAW_RESPONSE_KEY } from './raw-response.decorator';
import { getRequestId, IncomingRequestLike } from './request-context';

/**
 * Wraps every successful controller return value in the standard API envelope,
 * unless the handler is annotated with @RawResponse(). If a handler already
 * returns an envelope, we pass it through (but backfill the request id).
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<IncomingRequestLike>();
    const requestId = getRequestId(req);

    return next.handle().pipe(
      map((payload): unknown => {
        if (isRaw) {
          return payload;
        }
        if (isApiEnvelope(payload)) {
          const meta: ApiMeta = { ...payload.meta, requestId };
          return { ...payload, meta };
        }
        const meta: ApiMeta = { requestId };
        return envelopeOk(payload, meta) satisfies ApiEnvelope<unknown>;
      }),
    );
  }
}
