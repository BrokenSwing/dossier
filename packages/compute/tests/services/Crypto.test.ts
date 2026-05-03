import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CryptoService, CryptoServiceLive } from "../../src/services/Crypto.js";

const DEK = new Uint8Array(32).fill(42);

describe("CryptoService", () => {
  it.effect("encrypts and decrypts roundtrip", () =>
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const plaintext = new TextEncoder().encode("hello, world");
      const encrypted = yield* crypto.encrypt(plaintext, DEK);
      const decrypted = yield* crypto.decrypt(encrypted, DEK);
      expect(decrypted).toEqual(plaintext);
    }).pipe(Effect.provide(CryptoServiceLive)),
  );

  it.effect("each encryption produces a different ciphertext (random IV)", () =>
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const plaintext = new TextEncoder().encode("same content");
      const a = yield* crypto.encrypt(plaintext, DEK);
      const b = yield* crypto.encrypt(plaintext, DEK);
      expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
    }).pipe(Effect.provide(CryptoServiceLive)),
  );

  it.effect("fails to decrypt with a different key", () =>
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const wrongDek = new Uint8Array(32).fill(99);
      const plaintext = new TextEncoder().encode("secret");
      const encrypted = yield* crypto.encrypt(plaintext, DEK);
      const exit = yield* Effect.exit(crypto.decrypt(encrypted, wrongDek));
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(CryptoServiceLive)),
  );

  it.effect("fails to decrypt tampered ciphertext", () =>
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const plaintext = new TextEncoder().encode("secret");
      const encrypted = yield* crypto.encrypt(plaintext, DEK);
      encrypted[20] ^= 0xff;
      const exit = yield* Effect.exit(crypto.decrypt(encrypted, DEK));
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(CryptoServiceLive)),
  );

  it.effect("fails to decrypt data that is too short", () =>
    Effect.gen(function* () {
      const crypto = yield* CryptoService;
      const tooShort = new Uint8Array(5);
      const exit = yield* Effect.exit(crypto.decrypt(tooShort, DEK));
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(CryptoServiceLive)),
  );
});
