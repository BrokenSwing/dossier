import { StorageAuth, STORAGE_SESSION_HEADER, InvalidSessionError, UserId } from "@dossier/shared";
import * as Headers from "@effect/platform/Headers";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import jwt from "jsonwebtoken";

import { AppConfig } from "../Config.js";

export const StorageAuthLive = Layer.effect(
  StorageAuth,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const sql = yield* SqlClient;

    return StorageAuth.of(({ headers }) =>
      Effect.gen(function* () {
        const raw = Headers.get(headers, STORAGE_SESSION_HEADER);
        if (Option.isNone(raw)) {
          return yield* Effect.fail(new InvalidSessionError({ message: "Missing session token" }));
        }

        const payload = yield* Effect.try({
          try: () => jwt.verify(raw.value, Redacted.value(config.jwtSecret)) as { sub: string; jti: string },
          catch: () => new InvalidSessionError({ message: "Invalid or expired token" }),
        });

        const sessions = yield* sql<{ id: string }>`
          SELECT id FROM sessions
          WHERE id = ${payload.jti}
            AND user_id = ${payload.sub}
            AND revoked_at IS NULL
            AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
          LIMIT 1`.pipe(Effect.mapError(() => new InvalidSessionError({ message: "Internal session lookup failed" })));

        if (sessions.length === 0) {
          return yield* Effect.fail(new InvalidSessionError({ message: "Session not found or revoked" }));
        }

        return { userId: payload.sub as UserId };
      }),
    );
  }),
);
