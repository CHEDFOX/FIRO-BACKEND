/**
 * A tiny, dependency-free Result type.
 *
 * Domain and application code returns `Result<T, E>` instead of throwing for
 * expected, non-exceptional failures (e.g. "not found", "already exists").
 * Infrastructure/presentation layers translate `Err` into an `AppError`.
 */

export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Map the success value, leaving an error untouched. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Return the value or a fallback if the result is an error. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
