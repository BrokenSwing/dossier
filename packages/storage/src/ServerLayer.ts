import * as http from "node:http";
import { fileURLToPath } from "node:url";

import { StorageRpcs } from "@dossier/shared";
import { NodeContext, NodeHttpServer } from "@effect/platform-node";
import { FileSystem } from "@effect/platform/FileSystem";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as RpcServer from "@effect/rpc/RpcServer";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AppConfig } from "./Config.js";
import { accountHandlers } from "./handlers/AccountHandlers.js";
import { authHandlers } from "./handlers/AuthHandlers.js";
import { collectionHandlers } from "./handlers/CollectionHandlers.js";
import { documentHandlers } from "./handlers/DocumentHandlers.js";
import { sessionHandlers } from "./handlers/SessionHandlers.js";
import { tagHandlers } from "./handlers/TagHandlers.js";
import { StorageAuthLive } from "./middleware/StorageAuth.js";
import { BlobUploadRoute } from "./routes/BlobUploadRoute.js";
import { layer as blobStoreLayer } from "./services/BlobStore.js";

const readMigrationSql = Effect.gen(function* () {
  const fs = yield* FileSystem;
  return yield* fs.readFileString(fileURLToPath(new URL("../migrations/001_initial.sql", import.meta.url)));
});

export const StorageServerLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { dbPath, blobDir, port } = yield* AppConfig;
    yield* Effect.log(`Storage service starting on port ${port}`);

    const migrationSql = yield* readMigrationSql;

    const NodeContextLayer = NodeContext.layer;
    const SqlLayer = SqliteClient.layer({ filename: dbPath });

    const MigrationLayer = Layer.effectDiscard(
      SqliteMigrator.make({ dumpSchema: () => Effect.void })({
        loader: SqliteMigrator.fromRecord({
          "001_initial": Effect.gen(function* () {
            const sql = yield* SqlClient;
            const statements = migrationSql
              .split(";")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            yield* Effect.forEach(statements, (stmt) => sql.unsafe(stmt), { discard: true });
          }),
        }),
      }),
    ).pipe(Layer.provide(SqlLayer));

    const BlobStoreLayer = blobStoreLayer(blobDir).pipe(Layer.provide(NodeContextLayer));

    const HandlerLayers = Layer.mergeAll(authHandlers, sessionHandlers, documentHandlers, tagHandlers, collectionHandlers, accountHandlers).pipe(
      Layer.provide(SqlLayer),
      Layer.provide(BlobStoreLayer),
    );

    const InfraLayers = Layer.mergeAll(StorageAuthLive, RpcSerialization.layerNdjson).pipe(Layer.provide(SqlLayer));

    const RpcLayer = RpcServer.layerHttpRouter({
      group: StorageRpcs,
      path: "/rpc",
      protocol: "http",
    }).pipe(Layer.provide(HandlerLayers), Layer.provide(InfraLayers));

    const AppLayer = Layer.mergeAll(RpcLayer, BlobUploadRoute, HttpLayerRouter.cors());

    return HttpLayerRouter.serve(AppLayer).pipe(
      Layer.provide(NodeHttpServer.layer(() => http.createServer(), { port })),
      Layer.provide(NodeContextLayer),
      Layer.provide(MigrationLayer),
      Layer.provide(SqlLayer),
      Layer.provide(BlobStoreLayer),
    );
  }),
).pipe(Layer.provide(NodeContext.layer));
