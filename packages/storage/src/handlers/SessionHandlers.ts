import { StorageSessionRpcs, STORAGE_SESSION_HEADER, InternalError } from "@dossier/shared";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import jwt from "jsonwebtoken";

export const sessionHandlers = StorageSessionRpcs.toLayer({
  // The handler receives (payload, options) where options.headers has the request headers.
  // The middleware already verified the token; just decode to get the jti.
  Logout: (_payload, { headers }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const rawToken = headers[STORAGE_SESSION_HEADER];
      if (!rawToken) return;

      const decoded = jwt.decode(rawToken) as { jti?: string } | null;
      const jti = decoded?.jti;
      if (!jti) return;

      yield* sql`
        UPDATE sessions
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ${jti}
      `.pipe(Effect.mapError(() => new InternalError({ message: "Failed to revoke session" })));
    }),
});
