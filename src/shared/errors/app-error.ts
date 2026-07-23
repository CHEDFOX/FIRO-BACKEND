import { ERROR_KIND_META, ErrorKind } from './error-codes';

export interface AppErrorOptions {
  readonly kind: ErrorKind;
  /** Stable machine-readable code, e.g. "experience.not_found". */
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

/**
 * The single error type crossing the application boundary.
 *
 * Modules throw (or return via Result) an AppError with a canonical kind and a
 * namespaced code. The global exception filter turns it into the API error
 * envelope with the correct HTTP status. Unknown/unexpected throwables are
 * mapped to an INTERNAL AppError so we never leak stack traces to clients.
 */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.kind = options.kind;
    this.code = options.code;
    this.details = options.details;
    const meta = ERROR_KIND_META[options.kind];
    this.httpStatus = meta.httpStatus;
    this.retryable = meta.retryable;
    if (options.cause !== undefined) {
      // Preserve the original cause for logging without exposing it.
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static of(options: AppErrorOptions): AppError {
    return new AppError(options);
  }

  static validation(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError({ kind: ErrorKind.VALIDATION, code, message, details });
  }

  static unauthenticated(
    code = 'auth.unauthenticated',
    message = 'Authentication required',
  ): AppError {
    return new AppError({ kind: ErrorKind.UNAUTHENTICATED, code, message });
  }

  static forbidden(code = 'auth.forbidden', message = 'Not allowed'): AppError {
    return new AppError({ kind: ErrorKind.FORBIDDEN, code, message });
  }

  static notFound(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError({ kind: ErrorKind.NOT_FOUND, code, message, details });
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError({ kind: ErrorKind.CONFLICT, code, message, details });
  }

  static internal(
    code = 'internal.error',
    message = 'Something went wrong',
    cause?: unknown,
  ): AppError {
    return new AppError({ kind: ErrorKind.INTERNAL, code, message, cause });
  }

  /** Coerce any thrown value into an AppError (unknowns become INTERNAL). */
  static from(value: unknown): AppError {
    if (value instanceof AppError) {
      return value;
    }
    if (value instanceof Error) {
      return AppError.internal('internal.error', value.message, value);
    }
    return AppError.internal('internal.error', 'Something went wrong', value);
  }
}
