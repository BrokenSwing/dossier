import * as crypto from "node:crypto";

import { DecryptionFailedError, EncryptionFailedError } from "@dossier/shared";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm" as const;

interface CryptoServiceInterface {
  readonly encrypt: (plaintext: Uint8Array, dek: Uint8Array) => Effect.Effect<Uint8Array, EncryptionFailedError>;
  readonly decrypt: (ciphertext: Uint8Array, dek: Uint8Array) => Effect.Effect<Uint8Array, DecryptionFailedError>;
}

export class CryptoService extends Context.Tag("@dossier/compute/CryptoService")<CryptoService, CryptoServiceInterface>() {}

export const CryptoServiceLive = Layer.succeed(CryptoService, {
  encrypt: (plaintext, dek) =>
    Effect.try({
      try: () => {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return new Uint8Array(Buffer.concat([iv, encrypted, tag]));
      },
      catch: (e) => new EncryptionFailedError({ message: `Encryption failed: ${String(e)}` }),
    }),

  decrypt: (data, dek) =>
    Effect.try({
      try: () => {
        const buf = Buffer.from(data);
        const iv = buf.subarray(0, IV_LENGTH);
        const tag = buf.subarray(buf.length - TAG_LENGTH);
        const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
        const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
        decipher.setAuthTag(tag);
        return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
      },
      catch: (e) => new DecryptionFailedError({ message: `Decryption failed: ${String(e)}` }),
    }),
});
