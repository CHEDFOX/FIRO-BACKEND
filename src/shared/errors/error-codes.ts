/**
 * Canonical error codes for the API.
 *
 * Every error returned to a client carries a stable, machine-readable `code`
 * (e.g. "experience.not_found"). Codes are namespaced by domain. This registry
 * maps a generic set of kinds to HTTP status + default retryability; module
 * code composes specific codes on top (see AppError.of).
 */

export interface ErrorKindMeta {
  readonly httpStatus: number;
  readonly retryable: boolean;
}

export const ErrorKind = {
  VALIDATION: 'validation',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable',
  INTERNAL: 'internal',
} as const;

export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export const ERROR_KIND_META: Record<ErrorKind, ErrorKindMeta> = {
  [ErrorKind.VALIDATION]: { httpStatus: 400, retryable: false },
  [ErrorKind.UNAUTHENTICATED]: { httpStatus: 401, retryable: false },
  [ErrorKind.FORBIDDEN]: { httpStatus: 403, retryable: false },
  [ErrorKind.NOT_FOUND]: { httpStatus: 404, retryable: false },
  [ErrorKind.CONFLICT]: { httpStatus: 409, retryable: false },
  [ErrorKind.RATE_LIMITED]: { httpStatus: 429, retryable: true },
  [ErrorKind.UNAVAILABLE]: { httpStatus: 503, retryable: true },
  [ErrorKind.INTERNAL]: { httpStatus: 500, retryable: false },
};
