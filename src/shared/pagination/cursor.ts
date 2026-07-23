import { AppError } from '../errors/app-error';

/**
 * Opaque cursor pagination. Cursors are base64url-encoded JSON payloads; the
 * client treats them as opaque strings. We use keyset (seek) pagination, never
 * offset/limit, so pages stay stable and fast at scale.
 * See docs/architecture/08-api-and-design-system.md.
 */

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: T[];
  readonly next: string | null;
  readonly hasMore: boolean;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function clampLimit(
  raw: number | string | undefined,
  fallback = DEFAULT_PAGE_LIMIT,
): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (n === undefined || Number.isNaN(n) || n <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('cursor is not an object');
    }
    return parsed as T;
  } catch {
    throw AppError.validation('pagination.invalid_cursor', 'The pagination cursor is invalid', {
      cursor,
    });
  }
}

/**
 * Build a Page from a fetched slice. Callers should fetch `limit + 1` rows to
 * cheaply detect whether more pages exist, then pass the surplus flag here.
 */
export function buildPage<T>(
  items: T[],
  limit: number,
  makeCursor: (last: T) => Record<string, unknown>,
): Page<T> {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;
  const last = pageItems[pageItems.length - 1];
  const next = hasMore && last !== undefined ? encodeCursor(makeCursor(last)) : null;
  return { items: pageItems, next, hasMore };
}
