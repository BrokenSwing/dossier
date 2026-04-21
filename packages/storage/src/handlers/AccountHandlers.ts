import { SqlClient } from "@effect/sql/SqlClient";
import * as argon2 from "argon2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  StorageAccountRpcs,
  StorageAuth,
  AuthContext,
  InternalError,
  InvalidCredentialsError,
} from "@dossier/shared";
import * as UserSql from "../sql/UserSql.js";

export const accountHandlers = StorageAccountRpcs.middleware(
  StorageAuth,
).toLayer({
  ChangePassword: ({
    oldAuthKey,
    newAuthKey,
    newKdfParams,
    newEncryptedDek,
    newDekIv,
  }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const { userId } = yield* AuthContext;

      const userOpt = yield* UserSql.findById(userId);
      if (Option.isNone(userOpt)) {
        return yield* new InvalidCredentialsError({
          message: "User not found",
        });
      }
      const user = userOpt.value;

      const valid = yield* Effect.tryPromise({
        try: () => argon2.verify(user.password_hash, oldAuthKey),
        catch: (e) =>
          new InternalError({ message: `argon2 verify failed: ${String(e)}` }),
      });
      if (!valid) {
        return yield* new InvalidCredentialsError({
          message: "Invalid credentials",
        });
      }

      const newHash = yield* Effect.tryPromise({
        try: () => argon2.hash(newAuthKey, { type: argon2.argon2id }),
        catch: (e) =>
          new InternalError({ message: `argon2 hash failed: ${String(e)}` }),
      });

      yield* sql
        .withTransaction(
          Effect.all([
            UserSql.updateUser(userId, {
              password_hash: newHash,
              kdf_params: JSON.stringify(newKdfParams),
              encrypted_dek: newEncryptedDek,
              dek_iv: newDekIv,
            }),
            UserSql.revokeAllSessions(userId),
          ]),
        )
        .pipe(
          Effect.mapError(
            (e) =>
              new InternalError({
                message: `Transaction failed: ${String(e)}`,
              }),
          ),
        );
    }),

  UpdateEncryptedDek: ({ newEncryptedDek, newDekIv }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      yield* UserSql.updateEncryptedDek(userId, newEncryptedDek, newDekIv);
    }),
});
