import { STORAGE_SESSION_HEADER, UserId } from "@dossier/shared";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import jwt from "jsonwebtoken";

import { AppConfig } from "../Config.js";
import { BlobStore } from "../services/BlobStore.js";
import * as DocumentSql from "../sql/DocumentSql.js";

export const BlobUploadRoute = HttpLayerRouter.add("PUT", "/blobs/:blobKey", (req) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const sql = yield* SqlClient;
    const blobStore = yield* BlobStore;
    const routeCtx = yield* HttpLayerRouter.RouteContext;

    const blobKey = routeCtx.params["blobKey"];
    if (!blobKey) return HttpServerResponse.empty({ status: 400 });

    const rawToken = req.headers[STORAGE_SESSION_HEADER] as string | undefined;
    if (!rawToken) return HttpServerResponse.empty({ status: 401 });

    let userId: UserId;
    let sessionId: string;
    try {
      const payload = jwt.verify(rawToken, Redacted.value(config.jwtSecret)) as {
        sub: string;
        jti: string;
      };
      userId = payload.sub as UserId;
      sessionId = payload.jti;
    } catch {
      return HttpServerResponse.empty({ status: 401 });
    }

    const sessions = yield* sql<{ id: string }>`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND user_id = ${userId}
          AND revoked_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
        LIMIT 1
      `.pipe(Effect.orElse(() => Effect.succeed([] as readonly { id: string }[])));

    if (sessions.length === 0) return HttpServerResponse.empty({ status: 401 });

    const docOpt = yield* DocumentSql.findByBlobKey(blobKey, userId);
    if (Option.isNone(docOpt) || docOpt.value.encrypted_size !== 0) {
      return HttpServerResponse.empty({ status: 404 });
    }

    const buf = yield* req.arrayBuffer.pipe(Effect.orElse(() => Effect.succeed(new ArrayBuffer(0))));
    yield* blobStore.write(blobKey, new Uint8Array(buf)).pipe(Effect.orDie);

    return HttpServerResponse.empty({ status: 204 });
  }),
);
