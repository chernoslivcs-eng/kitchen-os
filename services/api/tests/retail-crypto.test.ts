// M13: токени мережі лежать у БД тільки шифротекстом. AES-256-GCM,
// ключ виводиться з довільного секрету env (sha256 → 32 байти).
import { describe, it, expect } from 'vitest';
import { makeTokenCipher } from '../src/retail/crypto.js';

describe('makeTokenCipher', () => {
  const cipher = makeTokenCipher('test-secret');

  it('roundtrip: dec(enc(x)) === x', () => {
    const token = 'silpo-access-token-абвгд-123';
    expect(cipher.dec(cipher.enc(token))).toBe(token);
  });

  it('шифротекст не містить plaintext і різний між викликами (випадковий IV)', () => {
    const a = cipher.enc('the-token');
    const b = cipher.enc('the-token');
    expect(a).not.toContain('the-token');
    expect(a).not.toBe(b);
    expect(cipher.dec(a)).toBe(cipher.dec(b));
  });

  it('чужий ключ не розшифровує (GCM ловить підміну)', () => {
    const other = makeTokenCipher('another-secret');
    expect(() => other.dec(cipher.enc('t'))).toThrow();
  });
});
