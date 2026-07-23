import { AppError } from '../errors/app-error';
import { buildPage, clampLimit, decodeCursor, encodeCursor, MAX_PAGE_LIMIT } from './cursor';

describe('cursor pagination', () => {
  it('round-trips an opaque cursor', () => {
    const payload = { id: 'exp_123', createdAt: 1_800_000_000_000 };
    const cursor = encodeCursor(payload);
    expect(typeof cursor).toBe('string');
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it('produces url-safe cursors (base64url, no +/=)', () => {
    const cursor = encodeCursor({ a: '???>>><<<', b: 1 });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('throws a validation AppError on a malformed cursor', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(AppError);
    try {
      decodeCursor('bnVsbA=='); // base64 for "null" -> not an object
      throw new Error('expected decodeCursor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('pagination.invalid_cursor');
      expect((e as AppError).httpStatus).toBe(400);
    }
  });

  describe('clampLimit', () => {
    it('falls back to default for invalid input', () => {
      expect(clampLimit(undefined)).toBe(20);
      expect(clampLimit('abc')).toBe(20);
      expect(clampLimit(0)).toBe(20);
      expect(clampLimit(-5)).toBe(20);
    });
    it('caps at the maximum', () => {
      expect(clampLimit(9999)).toBe(MAX_PAGE_LIMIT);
    });
    it('parses numeric strings', () => {
      expect(clampLimit('35')).toBe(35);
    });
  });

  describe('buildPage', () => {
    const makeCursor = (n: number) => ({ n });

    it('detects more pages when an extra row is fetched', () => {
      const rows = [1, 2, 3, 4]; // limit 3, fetched 4
      const page = buildPage(rows, 3, makeCursor);
      expect(page.items).toEqual([1, 2, 3]);
      expect(page.hasMore).toBe(true);
      expect(page.next).not.toBeNull();
      expect(decodeCursor(page.next as string)).toEqual({ n: 3 });
    });

    it('reports the last page when no surplus row exists', () => {
      const page = buildPage([1, 2], 3, makeCursor);
      expect(page.items).toEqual([1, 2]);
      expect(page.hasMore).toBe(false);
      expect(page.next).toBeNull();
    });
  });
});
