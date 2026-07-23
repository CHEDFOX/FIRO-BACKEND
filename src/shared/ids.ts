import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 generator.
 *
 * UUIDv7 is time-ordered (48-bit Unix-ms timestamp in the most-significant
 * bits) which makes it k-sortable and index-friendly for Postgres primary
 * keys, while remaining globally unique and non-enumerable. See
 * docs/architecture/04-data-architecture.md.
 *
 * Layout (RFC 9562):
 *   - bits  0..47  : unix_ts_ms (big-endian)
 *   - bits 48..51  : version (0b0111 = 7)
 *   - bits 52..63  : rand_a (12 bits)
 *   - bits 64..65  : variant (0b10)
 *   - bits 66..127 : rand_b (62 bits)
 *
 * Within the same millisecond we keep a monotonic counter so ids generated in
 * a tight loop remain strictly increasing (and therefore sortable).
 */

let lastTimestamp = -1;
let counter = 0;

export function uuidv7(nowMs: number = Date.now()): string {
  let timestamp = nowMs;

  if (timestamp === lastTimestamp) {
    counter += 1;
  } else {
    lastTimestamp = timestamp;
    counter = 0;
  }
  // If we ever overflow the counter within one ms, borrow from the next ms.
  if (counter > 0xfff) {
    timestamp += 1;
    lastTimestamp = timestamp;
    counter = 0;
  }

  const bytes = randomBytes(16);

  // 48-bit timestamp (big-endian) into bytes 0..5.
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble of byte 6; low nibble carries the counter high bits.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  // Counter low 8 bits in byte 7 (monotonic within the same millisecond).
  bytes[7] = counter & 0xff;

  // Variant 0b10 in the two most-significant bits of byte 8.
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Extract the embedded millisecond timestamp from a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
