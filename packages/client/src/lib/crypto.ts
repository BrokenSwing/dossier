import { argon2id } from "hash-wasm";

import { KdfParams } from "@dossier/shared";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// --- Error type ---

export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
  message: Schema.String,
}) {}

// --- Encoding helpers (pure, no Effect needed) ---

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padding));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Typed cast for Web Crypto API: Uint8Array<ArrayBufferLike> → BufferSource
const asBufferSource = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

// --- Key derivation ---

// Argon2id KDF: password + kdfParams → 32-byte masterKey
export const deriveMasterKey = (password: string, kdfParams: KdfParams): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.tryPromise({
    try: () =>
      argon2id({
        password: new TextEncoder().encode(password),
        salt: hexToBytes(kdfParams.salt),
        parallelism: kdfParams.parallelism,
        iterations: kdfParams.iterations,
        memorySize: kdfParams.memory,
        hashLength: 32,
        outputType: "binary",
      }),
    catch: (e) => new CryptoError({ message: `Key derivation failed: ${String(e)}` }),
  });

// HKDF split: masterKey → KEK (as CryptoKey for AES-GCM)
export const deriveKek = (masterKey: Uint8Array): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.tryPromise({
    try: async () => {
      const keyMaterial = await crypto.subtle.importKey("raw", asBufferSource(masterKey), "HKDF", false, ["deriveBits"]);
      const kekBits = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("kek") },
        keyMaterial,
        256,
      );
      return crypto.subtle.importKey("raw", kekBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    },
    catch: (e) => new CryptoError({ message: `KEK derivation failed: ${String(e)}` }),
  });

// HKDF split: masterKey → authKey (hex-encoded, sent to storage for password verification)
export const deriveAuthKey = (masterKey: Uint8Array): Effect.Effect<string, CryptoError> =>
  Effect.tryPromise({
    try: async () => {
      const keyMaterial = await crypto.subtle.importKey("raw", asBufferSource(masterKey), "HKDF", false, ["deriveBits"]);
      const authBits = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("auth") },
        keyMaterial,
        256,
      );
      return bytesToHex(new Uint8Array(authBits));
    },
    catch: (e) => new CryptoError({ message: `Auth key derivation failed: ${String(e)}` }),
  });

// --- Key generation (synchronous, infallible) ---

export const generateKdfParams = (): KdfParams => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return new KdfParams({ memory: 65536, iterations: 3, parallelism: 1, salt: bytesToHex(salt) });
};

export const generateDek = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

// --- DEK wrap / unwrap (AES-256-GCM) ---

export const wrapDek = (dek: Uint8Array, kek: CryptoKey): Effect.Effect<{ encryptedDek: string; dekIv: string }, CryptoError> =>
  Effect.tryPromise({
    try: async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, asBufferSource(dek));
      return { encryptedDek: bytesToBase64Url(new Uint8Array(encrypted)), dekIv: bytesToBase64Url(iv) };
    },
    catch: (e) => new CryptoError({ message: `DEK wrap failed: ${String(e)}` }),
  });

export const unwrapDek = (encryptedDek: string, dekIv: string, kek: CryptoKey): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.tryPromise({
    try: async () => {
      const iv = asBufferSource(base64UrlToBytes(dekIv));
      const ciphertext = base64UrlToBytes(encryptedDek);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, asBufferSource(ciphertext));
      return new Uint8Array(plaintext);
    },
    catch: (e) => new CryptoError({ message: `DEK unwrap failed: ${String(e)}` }),
  });
