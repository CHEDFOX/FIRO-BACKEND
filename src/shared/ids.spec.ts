import { isUuid, uuidv7, uuidv7Timestamp } from './ids';

describe('uuidv7', () => {
  it('produces a well-formed UUID string', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id).toHaveLength(36);
  });

  it('sets version 7 and the RFC variant', () => {
    const id = uuidv7();
    const hex = id.replace(/-/g, '');
    // version nibble (13th hex char) must be '7'
    expect(hex[12]).toBe('7');
    // variant: high bits of the 17th hex char must be 0b10 -> one of 8,9,a,b
    expect(['8', '9', 'a', 'b']).toContain(hex[16].toLowerCase());
  });

  it('is unique across many generations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      set.add(uuidv7());
    }
    expect(set.size).toBe(10_000);
  });

  it('is monotonically increasing when generated in a tight loop (sortable)', () => {
    const ids: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      ids.push(uuidv7());
    }
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('embeds the millisecond timestamp', () => {
    const now = 1_800_000_000_000; // fixed ms
    const id = uuidv7(now);
    expect(uuidv7Timestamp(id)).toBe(now);
  });

  it('orders ids across increasing timestamps', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a < b).toBe(true);
  });
});
