// Шифрування токенів мережі перед БД. AES-256-GCM: IV випадковий на кожен
// виклик, тег автентичності ловить і чужий ключ, і підміну шифротексту.
// Секрет — довільний рядок з env (RETAIL_TOKEN_SECRET); ключ = sha256(секрет).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface TokenCipher {
  enc(plain: string): string;
  dec(encoded: string): string;
}

export function makeTokenCipher(secret: string): TokenCipher {
  const key = createHash('sha256').update(secret).digest();
  return {
    enc(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
    },
    dec(encoded: string): string {
      const raw = Buffer.from(encoded, 'base64');
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
