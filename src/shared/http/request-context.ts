import { uuidv7 } from '../ids';

/** Minimal shape we rely on from the underlying (Fastify) request. */
export interface IncomingRequestLike {
  readonly id?: string | number;
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * Resolve a stable request id for correlation/tracing:
 * prefer an inbound `x-request-id` header, then the adapter's own id, then a
 * freshly generated UUIDv7.
 */
export function getRequestId(req: IncomingRequestLike | undefined): string {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  if (Array.isArray(header) && header.length > 0 && header[0]) {
    return header[0];
  }
  if (req?.id !== undefined && req.id !== null) {
    return String(req.id);
  }
  return uuidv7();
}
