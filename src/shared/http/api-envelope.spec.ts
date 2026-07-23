import { envelopeError, envelopeOk, isApiEnvelope } from './api-envelope';

describe('api envelope', () => {
  it('wraps data with a null error', () => {
    const env = envelopeOk({ id: 1 }, { requestId: 'req_1' });
    expect(env).toEqual({ data: { id: 1 }, meta: { requestId: 'req_1' }, error: null });
  });

  it('wraps an error with null data', () => {
    const env = envelopeError(
      { code: 'x.bad', message: 'bad', retryable: false },
      { requestId: 'req_2' },
    );
    expect(env.data).toBeNull();
    expect(env.error?.code).toBe('x.bad');
  });

  describe('isApiEnvelope', () => {
    it('recognises a full envelope', () => {
      expect(isApiEnvelope(envelopeOk('x', { requestId: 'r' }))).toBe(true);
    });
    it('rejects plain objects and primitives', () => {
      expect(isApiEnvelope({ data: 1 })).toBe(false);
      expect(isApiEnvelope(null)).toBe(false);
      expect(isApiEnvelope('str')).toBe(false);
      expect(isApiEnvelope(42)).toBe(false);
    });
  });
});
