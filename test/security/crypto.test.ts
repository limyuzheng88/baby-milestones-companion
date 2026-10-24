import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { decrypt, encrypt } from '../../src/security/crypto';

const OTHER_KEY = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';

describe('field encryption', () => {
  test('round-trips text', async () => {
    const blob = await encrypt('3 rolls in a row', env.ENCRYPTION_KEY);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(await decrypt(blob, env.ENCRYPTION_KEY)).toBe('3 rolls in a row');
  });

  test('same text encrypts differently each time', async () => {
    const a = await encrypt('same', env.ENCRYPTION_KEY);
    const b = await encrypt('same', env.ENCRYPTION_KEY);
    expect(a).not.toBe(b);
  });

  test('tampered ciphertext is rejected', async () => {
    const blob = await encrypt('secret note', env.ENCRYPTION_KEY);
    const last = blob.at(-2) === 'A' ? 'B' : 'A';
    const tampered = blob.slice(0, -2) + last + blob.slice(-1);
    await expect(decrypt(tampered, env.ENCRYPTION_KEY)).rejects.toThrow();
  });

  test('wrong key is rejected', async () => {
    const blob = await encrypt('secret note', env.ENCRYPTION_KEY);
    await expect(decrypt(blob, OTHER_KEY)).rejects.toThrow();
  });

  test('empty string round-trips', async () => {
    expect(await decrypt(await encrypt('', env.ENCRYPTION_KEY), env.ENCRYPTION_KEY)).toBe('');
  });

  test('unicode round-trips', async () => {
    const text = 'Ah Ma said 好棒 🎉';
    expect(await decrypt(await encrypt(text, env.ENCRYPTION_KEY), env.ENCRYPTION_KEY)).toBe(text);
  });
});
