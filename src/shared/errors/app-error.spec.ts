import { HttpException, NotFoundException } from '@nestjs/common';
import { AppError } from './app-error';
import { ErrorKind } from './error-codes';

describe('AppError', () => {
  it('maps kinds to the correct HTTP status and retryability', () => {
    expect(AppError.notFound('experience.not_found', 'nope').httpStatus).toBe(404);
    expect(AppError.validation('x.invalid', 'bad').httpStatus).toBe(400);
    expect(AppError.unauthenticated().httpStatus).toBe(401);
    expect(AppError.forbidden().httpStatus).toBe(403);
    expect(AppError.conflict('x.exists', 'dupe').httpStatus).toBe(409);

    const rateLimited = AppError.of({
      kind: ErrorKind.RATE_LIMITED,
      code: 'x.rate',
      message: 'slow down',
    });
    expect(rateLimited.httpStatus).toBe(429);
    expect(rateLimited.retryable).toBe(true);
  });

  it('carries a stable code and optional details', () => {
    const err = AppError.notFound('experience.not_found', 'Not found', { id: 'exp_1' });
    expect(err.code).toBe('experience.not_found');
    expect(err.details).toEqual({ id: 'exp_1' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  describe('from()', () => {
    it('returns AppError instances unchanged', () => {
      const original = AppError.forbidden();
      expect(AppError.from(original)).toBe(original);
    });

    it('wraps a plain Error as INTERNAL without leaking the type', () => {
      const wrapped = AppError.from(new Error('boom'));
      expect(wrapped.kind).toBe(ErrorKind.INTERNAL);
      expect(wrapped.httpStatus).toBe(500);
      expect(wrapped.message).toBe('boom');
    });

    it('wraps non-error throwables as INTERNAL', () => {
      const wrapped = AppError.from('a string was thrown');
      expect(wrapped.kind).toBe(ErrorKind.INTERNAL);
      expect(wrapped.httpStatus).toBe(500);
    });
  });

  it('is distinguishable from a Nest HttpException', () => {
    const nest: HttpException = new NotFoundException('x');
    expect(nest instanceof AppError).toBe(false);
  });
});
