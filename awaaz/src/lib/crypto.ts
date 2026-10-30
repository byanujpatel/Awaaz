/**
 * Device identity (ed25519) and family encryption (XChaCha20-Poly1305).
 * Encryption happens in the app, so it works the same on any Waku backend:
 * relay nodes only ever see ciphertext on a hashed topic name.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils';

export type Identity = { priv: string; pub: string };

export function newIdentity(): Identity {
  const priv = ed25519.utils.randomPrivateKey();
  return { priv: bytesToHex(priv), pub: bytesToHex(ed25519.getPublicKey(priv)) };
}

export function newFamilyKey(): string {
  return bytesToHex(randomBytes(32));
}

/** Topic-safe id: reveals nothing about the family, and needs the key to derive. */
export function familyIdFromKey(keyHex: string): string {
  return bytesToHex(sha256(utf8ToBytes(`awaaz-family:${keyHex}`))).slice(0, 16);
}

const PAIR_PREFIX = 'awaaz://family/';

export function pairCode(keyHex: string): string {
  return PAIR_PREFIX + keyHex;
}

/** Accepts the full pair link or a bare 64-char hex key. */
export function parsePairCode(input: string): string | null {
  const s = input.trim().replace(PAIR_PREFIX, '');
  return /^[0-9a-f]{64}$/i.test(s) ? s.toLowerCase() : null;
}

function canonical(obj: Record<string, unknown>): Uint8Array {
  const { sig: _sig, ...rest } = obj;
  return utf8ToBytes(JSON.stringify(rest, Object.keys(rest).sort()));
}

export function sign<T extends Record<string, unknown>>(msg: T, id: Identity): T & { sig: string } {
  const sig = bytesToHex(ed25519.sign(canonical(msg), hexToBytes(id.priv)));
  return { ...msg, sig };
}

export function verify(msg: Record<string, unknown>): boolean {
  try {
    if (typeof msg.sig !== 'string' || typeof msg.from !== 'string') return false;
    return ed25519.verify(hexToBytes(msg.sig), canonical(msg), hexToBytes(msg.from));
  } catch {
    return false;
  }
}

export function encrypt(plain: Uint8Array, keyHex: string): Uint8Array {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(hexToBytes(keyHex), nonce).encrypt(plain);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

export function decrypt(payload: Uint8Array, keyHex: string): Uint8Array | null {
  if (payload.length < 24 + 16) return null;
  try {
    return xchacha20poly1305(hexToBytes(keyHex), payload.subarray(0, 24)).decrypt(
      payload.subarray(24)
    );
  } catch {
    return null;
  }
}
