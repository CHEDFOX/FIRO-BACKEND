import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { ErrorKind } from '../errors/error-codes';
import { ApiError, envelopeError } from './api-envelope';
import { getRequestId, IncomingRequestLike } from './request-context';

/** Minimal shape we rely on from the underlying (Fastify) reply. */
interface ReplyLike {
  status(code: number): ReplyLike;
  send(payload: unknown): unknown;
}

/**
 * Translates every thrown error into the standard API error envelope with the
 * correct HTTP status and a stable code. Unknown throwables become a 500
 * without leaking internals; AppError and Nest HttpException are mapped
 * faithfully.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingRequestLike>();
    const reply = http.getResponse<ReplyLike>();
    const requestId = getRequestId(req);

    const appError = this.toAppError(exception);

    if (appError.kind === ErrorKind.INTERNAL) {
      this.logger.error(
        `[${requestId}] ${appError.code}: ${appError.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${appError.httpStatus} ${appError.code}: ${appError.message}`,
      );
    }

    const apiError: ApiError = {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
      ...(appError.details ? { details: appError.details } : {}),
    };

    reply.status(appError.httpStatus).send(envelopeError(apiError, { requestId }));
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) {
      return exception;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] })?.message?.toString() ??
            exception.message);
      return AppError.of({
        kind: this.kindForStatus(status),
        code: `http.${status}`,
        message,
      });
    }
    return AppError.from(exception);
  }

  private kindForStatus(status: number): ErrorKind {
    switch (status) {
      case 400:
        return ErrorKind.VALIDATION;
      case 401:
        return ErrorKind.UNAUTHENTICATED;
      case 403:
        return ErrorKind.FORBIDDEN;
      case 404:
        return ErrorKind.NOT_FOUND;
      case 409:
        return ErrorKind.CONFLICT;
      case 429:
        return ErrorKind.RATE_LIMITED;
      case 503:
        return ErrorKind.UNAVAILABLE;
      default:
        return status >= 500 ? ErrorKind.INTERNAL : ErrorKind.VALIDATION;
    }
  }
}
