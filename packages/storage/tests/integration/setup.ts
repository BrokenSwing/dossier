import * as net from "node:net";

import { KdfParams, StorageRpcs, STORAGE_SESSION_HEADER } from "@dossier/shared";
import { NodeContext, NodeHttpClient } from "@effect/platform-node";
import { FileSystem } from "@effect/platform/FileSystem";
import * as RpcClient from "@effect/rpc/RpcClient";
import type { RpcClientError } from "@effect/rpc/RpcClientError";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { authenticator } from "otplib";

import { StorageServerLayer } from "../../src/ServerLayer.js";

export const TEST_JWT_SECRET = "integration-test-jwt-secret";

export const TEST_KDF_PARAMS = new KdfParams({
  memory: 65536,
  iterations: 3,
  parallelism: 4,
  salt: "integration-test-salt",
});

// --- Tags ---

export class TestPort extends Context.Tag("dossier/integration/TestPort")<TestPort, number>() {}

export class StorageRpcClient extends Context.Tag("dossier/integration/StorageRpcClient")<
  StorageRpcClient,
  RpcClient.FromGroup<typeof StorageRpcs, RpcClientError>
>() {}

// --- Internal helpers ---

const findFreePort: Effect.Effect<number> = Effect.async((resume) => {
  const srv = net.createServer();
  srv.listen(0, "127.0.0.1", () => {
    const { port } = srv.address() as net.AddressInfo;
    srv.close(() => resume(Effect.succeed(port)));
  });
  srv.on("error", (err) => resume(Effect.die(err)));
});

const makeTestConfigProvider = (port: number, blobDir: string) =>
  ConfigProvider.fromMap(
    new Map([
      ["PORT", String(port)],
      ["JWT_SECRET", TEST_JWT_SECRET],
      ["JWT_EXPIRY_SECONDS", "86400"],
      ["DB_PATH", ":memory:"],
      ["BLOB_DIR", blobDir],
    ]),
  );

// --- Layers ---

// Starts the storage server on a free port; stops it and removes the temp blob
// dir when the scope closes (i.e. when the @effect/vitest layer() suite ends).
const TestServerLayer = Layer.scoped(
  TestPort,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const port = yield* findFreePort;
    const blobDir = yield* fs.makeTempDirectory({ prefix: "dossier-int-" }).pipe(Effect.orDie);

    const testLayer = StorageServerLayer.pipe(Layer.provide(Layer.setConfigProvider(makeTestConfigProvider(port, blobDir))));

    const serverScope = yield* Scope.make();
    yield* Layer.buildWithScope(testLayer, serverScope).pipe(Effect.orDie);

    yield* Effect.addFinalizer(() =>
      Effect.all([Scope.close(serverScope, Exit.void).pipe(Effect.orDie), fs.remove(blobDir, { recursive: true }).pipe(Effect.orDie)], {
        discard: true,
      }),
    );

    return port;
  }),
);

// Provides an RPC client pointed at the test server's port.
const StorageRpcClientLayer: Layer.Layer<StorageRpcClient, never, TestPort> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* TestPort;
    const url = `http://127.0.0.1:${port}/rpc`;
    const protocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(NodeHttpClient.layer));
    return Layer.scoped(StorageRpcClient, RpcClient.make(StorageRpcs)).pipe(Layer.provide(protocolLayer));
  }),
);

// Full integration layer used in layer() calls: starts the server, provides the
// RPC client, and exposes the bound port.
export const StorageIntegrationLayer = Layer.mergeAll(StorageRpcClientLayer.pipe(Layer.provide(TestServerLayer)), TestServerLayer).pipe(
  Layer.provide(NodeContext.layer),
);

// --- Auth helpers ---

// Registers a user, confirms TOTP, and returns a valid session token.
// Reads StorageRpcClient from context.
export const fullAuthFlow = (username: string): Effect.Effect<string, unknown, StorageRpcClient> =>
  Effect.gen(function* () {
    const client = yield* StorageRpcClient;
    const { totpUri } = yield* client.Register({
      username,
      authKey: "test-auth-key",
      kdfParams: TEST_KDF_PARAMS,
      encryptedDek: "enc-dek-base64",
      dekIv: "iv-base64",
    });
    const secret = new URL(totpUri).searchParams.get("secret")!;
    yield* client.ConfirmTotp({ username, totpCode: authenticator.generate(secret) });
    const { sessionToken } = yield* client.Login({
      username,
      authKey: "test-auth-key",
      totpCode: authenticator.generate(secret),
    });
    return sessionToken;
  });

export { STORAGE_SESSION_HEADER };
