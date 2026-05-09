import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { authenticator } from "otplib";

import { STORAGE_SESSION_HEADER, StorageIntegrationLayer, StorageRpcClient, TEST_KDF_PARAMS, fullAuthFlow } from "./setup.js";

layer(StorageIntegrationLayer)("Storage HTTP integration — auth", (it) => {
  describe("Register", () => {
    it.scoped("returns a TOTP URI for a new user", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const { totpUri } = yield* client.Register({
          username: "reg_basic",
          authKey: "auth-key",
          kdfParams: TEST_KDF_PARAMS,
          encryptedDek: "enc-dek",
          dekIv: "dek-iv",
        });
        expect(totpUri).toMatch(/^otpauth:\/\/totp\//);
        expect(new URL(totpUri).searchParams.get("secret")).toBeTruthy();
      }),
    );

    it.scoped("rejects a duplicate username", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        yield* client.Register({ username: "dup_user", authKey: "k", kdfParams: TEST_KDF_PARAMS, encryptedDek: "e", dekIv: "i" });
        const exit = yield* Effect.exit(
          client.Register({ username: "dup_user", authKey: "k", kdfParams: TEST_KDF_PARAMS, encryptedDek: "e", dekIv: "i" }),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("ConfirmTotp", () => {
    it.scoped("confirms TOTP with a valid code", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const { totpUri } = yield* client.Register({
          username: "confirm_totp_ok",
          authKey: "k",
          kdfParams: TEST_KDF_PARAMS,
          encryptedDek: "e",
          dekIv: "i",
        });
        const secret = new URL(totpUri).searchParams.get("secret")!;
        const exit = yield* Effect.exit(client.ConfirmTotp({ username: "confirm_totp_ok", totpCode: authenticator.generate(secret) }));
        expect(exit._tag).toBe("Success");
      }),
    );

    it.scoped("rejects an invalid TOTP code", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        yield* client.Register({ username: "confirm_totp_bad", authKey: "k", kdfParams: TEST_KDF_PARAMS, encryptedDek: "e", dekIv: "i" });
        const exit = yield* Effect.exit(client.ConfirmTotp({ username: "confirm_totp_bad", totpCode: "000000" }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("Login", () => {
    it.scoped("issues a session token after full signup", () =>
      Effect.gen(function* () {
        const sessionToken = yield* fullAuthFlow("login_ok");
        expect(sessionToken).toBeTruthy();
      }),
    );

    it.scoped("rejects wrong auth key", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const { totpUri } = yield* client.Register({
          username: "login_bad_key",
          authKey: "test-auth-key",
          kdfParams: TEST_KDF_PARAMS,
          encryptedDek: "e",
          dekIv: "i",
        });
        const secret = new URL(totpUri).searchParams.get("secret")!;
        yield* client.ConfirmTotp({ username: "login_bad_key", totpCode: authenticator.generate(secret) });
        const exit = yield* Effect.exit(client.Login({ username: "login_bad_key", authKey: "wrong-key", totpCode: authenticator.generate(secret) }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("rejects if TOTP not confirmed", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        yield* client.Register({
          username: "login_unconfirmed",
          authKey: "test-auth-key",
          kdfParams: TEST_KDF_PARAMS,
          encryptedDek: "e",
          dekIv: "i",
        });
        const exit = yield* Effect.exit(client.Login({ username: "login_unconfirmed", authKey: "test-auth-key", totpCode: "000000" }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("ValidateSession", () => {
    it.scoped("accepts a valid session token", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* fullAuthFlow("validate_ok");
        const exit = yield* Effect.exit(client.ValidateSession(void 0, { headers: { [STORAGE_SESSION_HEADER]: token } }));
        expect(exit._tag).toBe("Success");
      }),
    );

    it.scoped("rejects a missing token", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const exit = yield* Effect.exit(client.ValidateSession(void 0));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("rejects a tampered token", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const exit = yield* Effect.exit(client.ValidateSession(void 0, { headers: { [STORAGE_SESSION_HEADER]: "not-a-real-jwt" } }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("Logout", () => {
    it.scoped("revokes the session so subsequent ValidateSession calls fail", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* fullAuthFlow("logout_revoke");
        yield* client.Logout(void 0, { headers: { [STORAGE_SESSION_HEADER]: token } });
        const exit = yield* Effect.exit(client.ValidateSession(void 0, { headers: { [STORAGE_SESSION_HEADER]: token } }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("GetKdfParams", () => {
    it.scoped("returns real params for a registered user", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        yield* client.Register({ username: "kdf_real", authKey: "k", kdfParams: TEST_KDF_PARAMS, encryptedDek: "enc-dek-base64", dekIv: "i" });
        const result = yield* client.GetKdfParams({ username: "kdf_real" });
        expect(result.kdfParams.salt).toBe(TEST_KDF_PARAMS.salt);
        expect(result.encryptedDek).toBe("enc-dek-base64");
      }),
    );

    it.scoped("returns deterministic fake params for an unknown user", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const r1 = yield* client.GetKdfParams({ username: "ghost_user_xyz" });
        const r2 = yield* client.GetKdfParams({ username: "ghost_user_xyz" });
        expect(r1.kdfParams.salt).toBe(r2.kdfParams.salt);
        expect(r1.encryptedDek).toBe(r2.encryptedDek);
      }),
    );
  });
});
