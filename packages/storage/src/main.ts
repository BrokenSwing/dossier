import * as http from "node:http"
import { fileURLToPath } from "node:url"

import { FileSystem } from "@effect/platform/FileSystem"
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import { HttpServerRequest } from "@effect/platform/HttpServerRequest"
import { NodeContext, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import * as RpcServer from "@effect/rpc/RpcServer"
import * as RpcSerialization from "@effect/rpc/RpcSerialization"
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient"
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator"
import { SqlClient } from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as jwt from "jsonwebtoken"

import {
  StorageRpcs,
  STORAGE_SESSION_HEADER,
  UserId,
} from "@dossier/shared"

import { AppConfig } from "./Config.js"
import { StorageAuthLive } from "./middleware/StorageAuth.js"
import { BlobStore, layer as blobStoreLayer } from "./services/BlobStore.js"
import { authHandlers } from "./handlers/AuthHandlers.js"
import { sessionHandlers } from "./handlers/SessionHandlers.js"
import { documentHandlers } from "./handlers/DocumentHandlers.js"
import { tagHandlers } from "./handlers/TagHandlers.js"
import { collectionHandlers } from "./handlers/CollectionHandlers.js"
import { accountHandlers } from "./handlers/AccountHandlers.js"
import * as DocumentSql from "./sql/DocumentSql.js"

// --- Blob upload route: PUT /blobs/:blobKey (not an RPC, D9) ---
const BlobUploadRoute = HttpLayerRouter.add(
  "PUT",
  "/blobs/:blobKey",
  (req) =>
    Effect.gen(function*() {
      const config = yield* AppConfig
      const sql = yield* SqlClient
      const blobStore = yield* BlobStore
      const routeCtx = yield* HttpLayerRouter.RouteContext

      const blobKey = routeCtx.params["blobKey"]
      if (!blobKey) return HttpServerResponse.empty({ status: 400 })

      const rawToken = req.headers[STORAGE_SESSION_HEADER] as string | undefined
      if (!rawToken) return HttpServerResponse.empty({ status: 401 })

      let userId: UserId
      let sessionId: string
      try {
        const payload = jwt.verify(rawToken, Redacted.value(config.jwtSecret)) as {
          sub: string
          jti: string
        }
        userId = payload.sub as UserId
        sessionId = payload.jti
      } catch {
        return HttpServerResponse.empty({ status: 401 })
      }

      const sessions = yield* sql<{ id: string }>`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND user_id = ${userId}
          AND revoked_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
        LIMIT 1
      `.pipe(Effect.orElse(() => Effect.succeed([] as readonly { id: string }[])))

      if (sessions.length === 0) return HttpServerResponse.empty({ status: 401 })

      const docOpt = yield* DocumentSql.findByBlobKey(blobKey, userId)
      if (Option.isNone(docOpt) || docOpt.value.encrypted_size !== 0) {
        return HttpServerResponse.empty({ status: 404 })
      }

      const buf = yield* req.arrayBuffer.pipe(
        Effect.orElse(() => Effect.succeed(new ArrayBuffer(0)))
      )
      yield* blobStore.write(blobKey, new Uint8Array(buf)).pipe(Effect.orDie)

      return HttpServerResponse.empty({ status: 204 })
    })
)

// --- Entry point ---

const MainLayer = Layer.unwrapEffect(
  Effect.gen(function*() {
    const { dbPath, blobDir, port } = yield* AppConfig
    yield* Effect.log(`Storage service starting on port ${port}`)

    // Infrastructure layers
    const SqlLayer = SqliteClient.layer({ filename: dbPath })

    const MigrationLayer = Layer.effectDiscard(
      SqliteMigrator.make({ dumpSchema: () => Effect.void })({
        loader: SqliteMigrator.fromRecord({
          "001_initial": Effect.gen(function* () {
            const fileSystem = yield* FileSystem
            const sql = yield* SqlClient
            const migrationSql = yield* fileSystem.readFileString(
              fileURLToPath(new URL("../../migrations/001_initial.sql", import.meta.url))
            )
            const statements = migrationSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0)
            yield* Effect.forEach(statements, (stmt) => sql.unsafe(stmt), { discard: true })
          }),
        }),
      })
    ).pipe(Layer.provide(Layer.merge(SqlLayer, NodeContextLayer)))

    const NodeContextLayer = NodeContext.layer

    const BlobStoreLayer = blobStoreLayer(blobDir).pipe(
      Layer.provide(NodeContextLayer)
    )

    // All RPC handler layers (provide Rpc.ToHandler<...> tags)
    const HandlerLayers = Layer.mergeAll(
      authHandlers,
      sessionHandlers,
      documentHandlers,
      tagHandlers,
      collectionHandlers,
      accountHandlers,
    ).pipe(
      Layer.provide(SqlLayer),
      Layer.provide(BlobStoreLayer),
    )

    // Middleware and serialization
    const InfraLayers = Layer.mergeAll(
      StorageAuthLive,
      RpcSerialization.layerNdjson,
    ).pipe(Layer.provide(SqlLayer))

    // RPC server registers POST /rpc route into HttpLayerRouter
    const RpcLayer = RpcServer.layerHttpRouter({
      group: StorageRpcs,
      path: "/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide(HandlerLayers),
      Layer.provide(InfraLayers),
    )

    // Full app layer (all routes registered into HttpLayerRouter)
    // Note: BlobUploadRoute's per-request deps (SqlClient, BlobStore) appear as
    // Request.From<"Requires", ...> — they are extracted by serve() and provided after.
    const AppLayer = Layer.mergeAll(
      RpcLayer,
      BlobUploadRoute,
    )

    return HttpLayerRouter.serve(AppLayer).pipe(
      Layer.provide(NodeHttpServer.layer(() => http.createServer(), { port })),
      Layer.provide(NodeContextLayer),
      Layer.provide(MigrationLayer),
      Layer.provide(SqlLayer),
      Layer.provide(BlobStoreLayer),
    )
  })
)

NodeRuntime.runMain(Layer.launch(MainLayer))
