import { SqlClient } from "@effect/sql/SqlClient";
import * as argon2 from "argon2";
import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import {
  StorageAuthRpcs,
  InternalError,
  InvalidCredentialsError,
  NotFoundError,
  TotpInvalidError,
  TotpNotConfirmedError,
  UsernameTakenError,
  KdfParams,
} from "@dossier/shared";
import { AppConfig } from "../Config.js";
import * as UserSql from "../sql/UserSql.js";

const DEFAULT_KDF = { memory: 65536, iterations: 3, parallelism: 4 };

const fakeSalt = (secret: string, username: string): string => {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`fake:${username}`);
  return hmac.digest("hex");
};

export const makeAuthHandlerImpl = (config: {
  jwtSecret: Redacted.Redacted<string>;
  jwtExpirySeconds: number;
}) =>
  StorageAuthRpcs.of({
    GetKdfParams: ({ username }) =>
      Effect.gen(function* () {
        const userOpt = yield* UserSql.findByUsername(username);

        if (Option.isSome(userOpt)) {
          const user = userOpt.value;
          const kdfParams = yield* Effect.try({
            try: () => JSON.parse(user.kdf_params) as KdfParams,
            catch: () =>
              new InternalError({ message: "Failed to parse kdf_params" }),
          });
          return {
            kdfParams,
            encryptedDek: user.encrypted_dek,
            dekIv: user.dek_iv,
          };
        }

        // D4: deterministic fake params for unknown usernames
        const secret = Redacted.value(config.jwtSecret);
        const salt = fakeSalt(secret, username);
        const fakeHmac = (suffix: string) => {
          const h = crypto.createHmac("sha256", secret);
          h.update(`fake-dek:${username}:${suffix}`);
          return h.digest("base64");
        };

        return {
          kdfParams: new KdfParams({ ...DEFAULT_KDF, salt }),
          encryptedDek: fakeHmac("dek"),
          dekIv: fakeHmac("iv").slice(0, 24),
        };
      }),

    Register: ({ username, authKey, kdfParams, encryptedDek, dekIv }) =>
      Effect.gen(function* () {
        const existing = yield* UserSql.findByUsername(username);
        if (Option.isSome(existing)) {
          return yield* Effect.fail(
            new UsernameTakenError({ message: "Username already taken" }),
          );
        }

        const passwordHash = yield* Effect.tryPromise({
          try: () => argon2.hash(authKey, { type: argon2.argon2id }),
          catch: (e) =>
            new InternalError({
              message: `argon2 hash failed: ${String(e)}`,
            }),
        });

        const totpSecret = authenticator.generateSecret();
        const totpUri = authenticator.keyuri(username, "Dossier", totpSecret);
        const userId = crypto.randomUUID();

        yield* UserSql.insertUser({
          id: userId,
          username,
          password_hash: passwordHash,
          totp_secret: totpSecret,
          encrypted_dek: encryptedDek,
          dek_iv: dekIv,
          kdf_params: JSON.stringify(kdfParams),
        });

        return { totpUri, userId };
      }),

    ConfirmTotp: ({ username, totpCode }) =>
      Effect.gen(function* () {
        const userOpt = yield* UserSql.findByUsername(username);
        if (Option.isNone(userOpt)) {
          return yield* Effect.fail(
            new NotFoundError({ message: "User not found" }),
          );
        }
        const user = userOpt.value;

        if (user.totp_confirmed === 1) return; // idempotent

        const valid = authenticator.verify({
          token: totpCode,
          secret: user.totp_secret,
        });
        if (!valid) {
          return yield* new TotpInvalidError({
            message: "Invalid TOTP code",
          });
        }

        yield* UserSql.setTotpConfirmed(user.id);
      }),

    Login: ({ username, authKey, totpCode }) =>
      Effect.gen(function* () {
        const userOpt = yield* UserSql.findByUsername(username);
        if (Option.isNone(userOpt)) {
          return yield* new InvalidCredentialsError({
            message: "Invalid credentials",
          });
        }
        const user = userOpt.value;

        const passwordValid = yield* Effect.tryPromise({
          try: () => argon2.verify(user.password_hash, authKey),
          catch: (e) =>
            new InternalError({
              message: `argon2 verify failed: ${String(e)}`,
            }),
        });
        if (!passwordValid) {
          return yield* new InvalidCredentialsError({
            message: "Invalid credentials",
          });
        }

        if (user.totp_confirmed === 0) {
          return yield* new TotpNotConfirmedError({
            message: "TOTP not yet confirmed",
          });
        }

        const totpValid = authenticator.verify({
          token: totpCode,
          secret: user.totp_secret,
        });
        if (!totpValid) {
          return yield* new TotpInvalidError({
            message: "Invalid TOTP code",
          });
        }

        const sessionId = crypto.randomUUID();
        const expiresAt = new Date(
          Date.now() + config.jwtExpirySeconds * 1000,
        ).toISOString();

        yield* UserSql.insertSession({
          id: sessionId,
          user_id: user.id,
          expires_at: expiresAt,
        });

        const sessionToken = jwt.sign(
          { sub: user.id, jti: sessionId },
          Redacted.value(config.jwtSecret),
          { expiresIn: config.jwtExpirySeconds },
        );

        return {
          sessionToken,
          encryptedDek: user.encrypted_dek,
          dekIv: user.dek_iv,
        };
      }),
  });

// Config is read once at layer construction; handlers close over the values.
export const authHandlers = StorageAuthRpcs.toLayer(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return makeAuthHandlerImpl(config);
  }),
);
