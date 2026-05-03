import { KdfParams } from "@dossier/shared";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  deriveAuthKey,
  deriveKek,
  deriveMasterKey,
  generateDek,
  generateKdfParams,
  hexToBytes,
  unwrapDek,
  wrapDek,
} from "../../src/lib/crypto.js";

// Low-cost params so tests run fast
const TEST_KDF_PARAMS = new KdfParams({ memory: 64, iterations: 1, parallelism: 1, salt: "deadbeef".repeat(4) });

describe("encoding helpers", () => {
  it("bytesToHex / hexToBytes roundtrip", () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0xab, 0x12]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it("bytesToBase64Url / base64UrlToBytes roundtrip", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it("base64Url output contains no +, / or = characters", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33)); // length not divisible by 3 forces padding
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("hexToBytes throws on odd-length input", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });
});

describe("deriveMasterKey", () => {
  it.effect("produces a 32-byte result", () =>
    Effect.gen(function* () {
      const key = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      expect(key).toHaveLength(32);
    }),
  );

  it.effect("is deterministic — same inputs → same output", () =>
    Effect.gen(function* () {
      const a = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const b = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      expect(a).toEqual(b);
    }),
  );

  it.effect("different passwords → different keys", () =>
    Effect.gen(function* () {
      const a = yield* deriveMasterKey("password1", TEST_KDF_PARAMS);
      const b = yield* deriveMasterKey("password2", TEST_KDF_PARAMS);
      expect(a).not.toEqual(b);
    }),
  );

  it.effect("different salts → different keys", () =>
    Effect.gen(function* () {
      const params2 = new KdfParams({ ...TEST_KDF_PARAMS, salt: "cafebabe".repeat(4) });
      const a = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const b = yield* deriveMasterKey("password", params2);
      expect(a).not.toEqual(b);
    }),
  );
});

describe("deriveKek + deriveAuthKey", () => {
  it.effect("deriveKek returns a CryptoKey", () =>
    Effect.gen(function* () {
      const masterKey = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const kek = yield* deriveKek(masterKey);
      expect(kek).toBeInstanceOf(CryptoKey);
    }),
  );

  it.effect("deriveAuthKey returns a 64-character hex string", () =>
    Effect.gen(function* () {
      const masterKey = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const authKey = yield* deriveAuthKey(masterKey);
      expect(authKey).toHaveLength(64);
      expect(authKey).toMatch(/^[0-9a-f]+$/);
    }),
  );

  it.effect("authKey from different masterKeys are different", () =>
    Effect.gen(function* () {
      const mk1 = yield* deriveMasterKey("password1", TEST_KDF_PARAMS);
      const mk2 = yield* deriveMasterKey("password2", TEST_KDF_PARAMS);
      const a = yield* deriveAuthKey(mk1);
      const b = yield* deriveAuthKey(mk2);
      expect(a).not.toBe(b);
    }),
  );

  it.effect("deriveAuthKey is deterministic", () =>
    Effect.gen(function* () {
      const masterKey = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const a = yield* deriveAuthKey(masterKey);
      const b = yield* deriveAuthKey(masterKey);
      expect(a).toBe(b);
    }),
  );
});

describe("generateKdfParams", () => {
  it("returns correct structure with expected defaults", () => {
    const params = generateKdfParams();
    expect(params.memory).toBe(65536);
    expect(params.iterations).toBe(3);
    expect(params.parallelism).toBe(1);
    expect(params.salt).toHaveLength(64); // 32 bytes → 64 hex chars
    expect(params.salt).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a different salt each time", () => {
    const a = generateKdfParams();
    const b = generateKdfParams();
    expect(a.salt).not.toBe(b.salt);
  });
});

describe("generateDek", () => {
  it("returns 32 bytes", () => {
    expect(generateDek()).toHaveLength(32);
  });

  it("generates different values each time", () => {
    expect(generateDek()).not.toEqual(generateDek());
  });
});

describe("wrapDek / unwrapDek", () => {
  it.effect("roundtrip: wrap then unwrap returns the original DEK", () =>
    Effect.gen(function* () {
      const masterKey = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const kek = yield* deriveKek(masterKey);
      const dek = generateDek();
      const { encryptedDek, dekIv } = yield* wrapDek(dek, kek);
      const recovered = yield* unwrapDek(encryptedDek, dekIv, kek);
      expect(recovered).toEqual(dek);
    }),
  );

  it.effect("wrap produces different ciphertext each time (random IV)", () =>
    Effect.gen(function* () {
      const masterKey = yield* deriveMasterKey("password", TEST_KDF_PARAMS);
      const kek = yield* deriveKek(masterKey);
      const dek = generateDek();
      const { encryptedDek: a } = yield* wrapDek(dek, kek);
      const { encryptedDek: b } = yield* wrapDek(dek, kek);
      expect(a).not.toBe(b);
    }),
  );

  it.effect("unwrap fails with the wrong KEK", () =>
    Effect.gen(function* () {
      const mk1 = yield* deriveMasterKey("password1", TEST_KDF_PARAMS);
      const mk2 = yield* deriveMasterKey("password2", TEST_KDF_PARAMS);
      const kek1 = yield* deriveKek(mk1);
      const kek2 = yield* deriveKek(mk2);
      const dek = generateDek();
      const { encryptedDek, dekIv } = yield* wrapDek(dek, kek1);
      const result = yield* Effect.either(unwrapDek(encryptedDek, dekIv, kek2));
      expect(result._tag).toBe("Left");
    }),
  );
});
