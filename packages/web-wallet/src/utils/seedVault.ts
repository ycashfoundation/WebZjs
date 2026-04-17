/**
 * Passphrase-encrypted seed vault. Persists a BIP39 mnemonic to IndexedDB as
 * an AES-GCM ciphertext keyed by PBKDF2(passphrase, salt). No plaintext seed
 * ever hits disk.
 *
 * Keep the seed phrase in memory only while the wallet is unlocked — the
 * vault deliberately does not expose a "remember me" / cached-key mode.
 */

import { get, set, del } from 'idb-keyval';

const VAULT_KEY = 'yw:encryptedSeed';

// PBKDF2 iteration count. 600k SHA-256 iterations is OWASP's 2024 floor for
// password-based key derivation; adjust cautiously, trading UX latency on
// unlock for brute-force resistance if the IndexedDB file is ever exfiltrated.
const PBKDF2_ITERATIONS = 600_000;

/**
 * Persisted vault shape. Version-tagged so we can migrate format if the
 * KDF/cipher is ever changed.
 */
export interface EncryptedSeed {
  v: 1;
  /** Base64 PBKDF2 salt (16 bytes). */
  salt: string;
  /** Base64 AES-GCM nonce (12 bytes). */
  iv: string;
  /** Base64 AES-GCM ciphertext (includes the 16-byte auth tag). */
  ct: string;
  iter: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSeed(
  mnemonic: string,
  passphrase: string,
): Promise<EncryptedSeed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(mnemonic),
    ),
  );
  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ct),
    iter: PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypts a vault entry. Throws on wrong passphrase (AES-GCM auth failure).
 * The caller is expected to surface this as a user-facing "wrong passphrase"
 * error without leaking crypto details.
 */
export async function decryptSeed(
  enc: EncryptedSeed,
  passphrase: string,
): Promise<string> {
  if (enc.v !== 1) {
    throw new Error(`Unsupported seed vault version: ${enc.v}`);
  }
  const salt = fromBase64(enc.salt);
  const iv = fromBase64(enc.iv);
  const ct = fromBase64(enc.ct);
  const key = await deriveKey(passphrase, salt, enc.iter);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

export async function saveEncryptedSeed(enc: EncryptedSeed): Promise<void> {
  await set(VAULT_KEY, enc);
}

export async function loadEncryptedSeed(): Promise<EncryptedSeed | null> {
  const got = (await get(VAULT_KEY)) as EncryptedSeed | undefined;
  return got ?? null;
}

export async function clearEncryptedSeed(): Promise<void> {
  await del(VAULT_KEY);
}
