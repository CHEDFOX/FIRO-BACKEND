import { ScryptPasswordHasher } from './scrypt-password-hasher';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('hashes to the documented format and verifies the correct password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
    expect(await hasher.verify('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('s3cret-password');
    expect(await hasher.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hasher.hash('same-input');
    const b = await hasher.hash('same-input');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await hasher.verify('x', 'not-a-valid-hash')).toBe(false);
    expect(await hasher.verify('x', 'bcrypt$1$2$3$4$5')).toBe(false);
  });
});
