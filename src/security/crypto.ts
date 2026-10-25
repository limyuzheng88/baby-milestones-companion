// AES-GCM field encryption for personal data stored in D1.
// Format: v1:<base64 iv>:<base64 ciphertext+tag>. The version prefix allows key rotation later.

const IV_BYTES = 12;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(keyB64: string): Promise<CryptoKey> {
  let key = keyCache.get(keyB64);
  if (!key) {
    const raw = fromB64(keyB64);
    if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(keyB64, key);
  }
  return key;
}

export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importKey(keyB64),
    new TextEncoder().encode(plain),
  );
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(cipher))}`;
}

export async function decrypt(blob: string, keyB64: string): Promise<string> {
  const [version, ivB64, cipherB64] = blob.split(':');
  if (version !== 'v1' || !ivB64 || !cipherB64) throw new Error('Unrecognised ciphertext format');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    await importKey(keyB64),
    fromB64(cipherB64),
  );
  return new TextDecoder().decode(plain);
}
