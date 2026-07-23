/**
 * The single response envelope for every JSON resource endpoint.
 * See docs/architecture/08-api-and-design-system.md.
 *
 *   { "data": <resource|list|null>,
 *     "meta": { "requestId": "...", "cursor": { "next": "...", "hasMore": true } },
 *     "error": <ApiError|null> }
 *
 * Media (signed URLs) and streaming (SSE/AI) are explicit carve-outs and do not
 * use this envelope.
 */

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
}

export interface CursorMeta {
  readonly next: string | null;
  readonly hasMore: boolean;
}

export interface ApiMeta {
  readonly requestId: string;
  readonly cursor?: CursorMeta;
}

export interface ApiEnvelope<T> {
  readonly data: T | null;
  readonly meta: ApiMeta;
  readonly error: ApiError | null;
}

export function envelopeOk<T>(data: T, meta: ApiMeta): ApiEnvelope<T> {
  return { data, meta, error: null };
}

export function envelopeError(error: ApiError, meta: ApiMeta): ApiEnvelope<null> {
  return { data: null, meta, error };
}

/** Type guard: is a controller return value already an envelope? */
export function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'data' in value && 'meta' in value && 'error' in value;
}
