import * as net from "node:net";

import { KdfParams, ComputeRpcs, StorageRpcs, COMPUTE_SESSION_HEADER, STORAGE_SESSION_HEADER } from "@dossier/shared";
import { StorageServerLayer } from "@dossier/storage/ServerLayer";
import { NodeContext, NodeHttpClient } from "@effect/platform-node";
import { FileSystem } from "@effect/platform/FileSystem";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
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

import { ComputeServerLayer } from "../../src/ComputeServerLayer.js";

// --- Constants ---

export const TEST_KDF_PARAMS = new KdfParams({
  memory: 65536,
  iterations: 3,
  parallelism: 4,
  salt: "compute-integration-test-salt",
});

// Fixed 32-byte DEK for tests (base64url encoded)
export const TEST_DEK_BYTES = Buffer.alloc(32, 0xab);
export const TEST_DEK = TEST_DEK_BYTES.toString("base64url");

// A rotated DEK used in key-rotation tests
export const TEST_NEW_DEK_BYTES = Buffer.alloc(32, 0xcd);
export const TEST_NEW_DEK = TEST_NEW_DEK_BYTES.toString("base64url");

// Minimal valid 1×1 PNG (format supported by WatermarkService)
export const MINIMAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

export { COMPUTE_SESSION_HEADER, STORAGE_SESSION_HEADER };

// --- Tags ---

export class StorageTestPort extends Context.Tag("dossier/integration/compute/StorageTestPort")<StorageTestPort, number>() {}
export class ComputeTestPort extends Context.Tag("dossier/integration/compute/ComputeTestPort")<ComputeTestPort, number>() {}

export class ComputeRpcClient extends Context.Tag("dossier/integration/compute/ComputeRpcClient")<
  ComputeRpcClient,
  RpcClient.FromGroup<typeof ComputeRpcs, RpcClientError>
>() {}

export class StorageRpcClient extends Context.Tag("dossier/integration/compute/StorageRpcClient")<
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

const makeStorageConfigProvider = (port: number, blobDir: string) =>
  ConfigProvider.fromMap(
    new Map([
      ["PORT", String(port)],
      ["JWT_SECRET", "compute-integration-test-jwt-secret"],
      ["JWT_EXPIRY_SECONDS", "86400"],
      ["DB_PATH", ":memory:"],
      ["BLOB_DIR", blobDir],
    ]),
  );

const makeComputeConfigProvider = (computePort: number, storagePort: number) =>
  ConfigProvider.fromMap(
    new Map([
      ["PORT", String(computePort)],
      ["STORAGE_URL", `http://127.0.0.1:${storagePort}`],
    ]),
  );

// --- Server layers ---

const StorageTestLayer = Layer.scoped(
  StorageTestPort,
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const port = yield* findFreePort;
    const blobDir = yield* fs.makeTempDirectory({ prefix: "dossier-compute-int-" }).pipe(Effect.orDie);

    const testLayer = StorageServerLayer.pipe(Layer.provide(Layer.setConfigProvider(makeStorageConfigProvider(port, blobDir))));

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

const ComputeTestLayer = Layer.scoped(
  ComputeTestPort,
  Effect.gen(function* () {
    const storagePort = yield* StorageTestPort;
    const computePort = yield* findFreePort;

    const testLayer = ComputeServerLayer.pipe(Layer.provide(Layer.setConfigProvider(makeComputeConfigProvider(computePort, storagePort))));

    const serverScope = yield* Scope.make();
    yield* Layer.buildWithScope(testLayer, serverScope).pipe(Effect.orDie);

    yield* Effect.addFinalizer(() => Scope.close(serverScope, Exit.void).pipe(Effect.orDie));

    return computePort;
  }),
);

const StorageRpcClientLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* StorageTestPort;
    const url = `http://127.0.0.1:${port}/rpc`;
    const protocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(NodeHttpClient.layer));
    return Layer.scoped(StorageRpcClient, RpcClient.make(StorageRpcs)).pipe(Layer.provide(protocolLayer));
  }),
);

const ComputeRpcClientLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* ComputeTestPort;
    const url = `http://127.0.0.1:${port}/rpc`;
    const protocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(NodeHttpClient.layer));
    return Layer.scoped(ComputeRpcClient, RpcClient.make(ComputeRpcs)).pipe(Layer.provide(protocolLayer));
  }),
);

// FullComputeTestLayer absorbs StorageTestLayer so it only needs FileSystem.
// By reusing the SAME StorageTestLayer/FullComputeTestLayer references in every arm of
// mergeAll, Effect's MemoMap ensures each server is started exactly once.
const FullComputeTestLayer = ComputeTestLayer.pipe(Layer.provide(StorageTestLayer));

export const ComputeIntegrationLayer = Layer.mergeAll(
  StorageTestLayer,
  FullComputeTestLayer,
  StorageRpcClientLayer.pipe(Layer.provide(StorageTestLayer)),
  ComputeRpcClientLayer.pipe(Layer.provide(FullComputeTestLayer)),
  NodeHttpClient.layer,
).pipe(Layer.provide(NodeContext.layer));

// --- Auth helpers ---

// Registers a new user against storage and returns a valid session token.
export const fullStorageAuthFlow = (username: string): Effect.Effect<string, unknown, StorageRpcClient> =>
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

// Uploads a document via POST /upload on the compute server.
// Returns the documentId.
export const uploadDocument = (
  computePort: number,
  sessionToken: string,
  content: Uint8Array,
  opts: { name: string; format: "pdf" | "jpg" | "png"; tags?: string[] },
): Effect.Effect<string, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const res = yield* httpClient
      .execute(
        HttpClientRequest.post(`http://127.0.0.1:${computePort}/upload`).pipe(
          HttpClientRequest.setHeader(COMPUTE_SESSION_HEADER, sessionToken),
          HttpClientRequest.setHeader("x-dossier-dek", TEST_DEK),
          HttpClientRequest.setHeader("x-document-name", opts.name),
          HttpClientRequest.setHeader("x-document-format", opts.format),
          HttpClientRequest.setHeader("x-document-tags", JSON.stringify(opts.tags ?? [])),
          HttpClientRequest.bodyUint8Array(content),
        ),
      )
      .pipe(Effect.orDie);

    if (res.status !== 201) yield* Effect.die(new Error(`Upload failed: ${res.status}`));

    const json = (yield* res.json.pipe(Effect.orDie)) as { documentId: string };
    return json.documentId;
  });
