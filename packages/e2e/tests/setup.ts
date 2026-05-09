import * as net from "node:net";

import { ComputeServerLayer } from "@dossier/compute/ComputeServerLayer";
import { KdfParams, ComputeRpcs, StorageRpcs, COMPUTE_SESSION_HEADER, STORAGE_SESSION_HEADER } from "@dossier/shared";
import { StorageServerLayer } from "@dossier/storage/ServerLayer";
import { NodeContext, NodeHttpClient } from "@effect/platform-node";
import { FileSystem } from "@effect/platform/FileSystem";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as RpcClient from "@effect/rpc/RpcClient";
import type { RpcClientError } from "@effect/rpc/RpcClientError";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as Chunk from "effect/Chunk";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { argon2id } from "hash-wasm";
import { authenticator } from "otplib";

export { COMPUTE_SESSION_HEADER, STORAGE_SESSION_HEADER };

// --- Crypto helpers (mirrors packages/client/src/lib/crypto.ts) ---
// Inlined because @dossier/client has no Node.js-compatible build output.

const asBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padding));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export const generateKdfParams = (): KdfParams => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return new KdfParams({ memory: 65536, iterations: 3, parallelism: 1, salt: bytesToHex(salt) });
};

export const generateDek = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

const deriveMasterKey = (password: string, kdfParams: KdfParams): Effect.Effect<Uint8Array> =>
  Effect.promise(() =>
    argon2id({
      password: new TextEncoder().encode(password),
      salt: hexToBytes(kdfParams.salt),
      parallelism: kdfParams.parallelism,
      iterations: kdfParams.iterations,
      memorySize: kdfParams.memory,
      hashLength: 32,
      outputType: "binary",
    }),
  );

const deriveKek = (masterKey: Uint8Array): Effect.Effect<CryptoKey> =>
  Effect.promise(async () => {
    const mat = await crypto.subtle.importKey("raw", asBuffer(masterKey), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("kek") },
      mat,
      256,
    );
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  });

const deriveAuthKey = (masterKey: Uint8Array): Effect.Effect<string> =>
  Effect.promise(async () => {
    const mat = await crypto.subtle.importKey("raw", asBuffer(masterKey), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("auth") },
      mat,
      256,
    );
    return bytesToHex(new Uint8Array(bits));
  });

const wrapDek = (dek: Uint8Array, kek: CryptoKey): Effect.Effect<{ encryptedDek: string; dekIv: string }> =>
  Effect.promise(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, asBuffer(dek));
    return { encryptedDek: bytesToBase64Url(new Uint8Array(enc)), dekIv: bytesToBase64Url(iv) };
  });

export const unwrapDek = (encryptedDek: string, dekIv: string, kek: CryptoKey): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const iv = asBuffer(base64UrlToBytes(dekIv));
    const ct = base64UrlToBytes(encryptedDek);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, kek, asBuffer(ct));
    return new Uint8Array(pt);
  });

// --- Tags ---

export class StorageTestPort extends Context.Tag("dossier/e2e/StorageTestPort")<StorageTestPort, number>() {}
export class ComputeTestPort extends Context.Tag("dossier/e2e/ComputeTestPort")<ComputeTestPort, number>() {}

export class StorageRpcClient extends Context.Tag("dossier/e2e/StorageRpcClient")<
  StorageRpcClient,
  RpcClient.FromGroup<typeof StorageRpcs, RpcClientError>
>() {}

export class ComputeRpcClient extends Context.Tag("dossier/e2e/ComputeRpcClient")<
  ComputeRpcClient,
  RpcClient.FromGroup<typeof ComputeRpcs, RpcClientError>
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

const makeStorageConfig = (port: number, blobDir: string) =>
  ConfigProvider.fromMap(
    new Map([
      ["PORT", String(port)],
      ["JWT_SECRET", "e2e-test-jwt-secret"],
      ["JWT_EXPIRY_SECONDS", "86400"],
      ["DB_PATH", ":memory:"],
      ["BLOB_DIR", blobDir],
    ]),
  );

const makeComputeConfig = (computePort: number, storagePort: number) =>
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
    const blobDir = yield* fs.makeTempDirectory({ prefix: "dossier-e2e-" }).pipe(Effect.orDie);
    const serverScope = yield* Scope.make();
    yield* Layer.buildWithScope(StorageServerLayer.pipe(Layer.provide(Layer.setConfigProvider(makeStorageConfig(port, blobDir)))), serverScope).pipe(
      Effect.orDie,
    );
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
    const serverScope = yield* Scope.make();
    yield* Layer.buildWithScope(
      ComputeServerLayer.pipe(Layer.provide(Layer.setConfigProvider(makeComputeConfig(computePort, storagePort)))),
      serverScope,
    ).pipe(Effect.orDie);
    yield* Effect.addFinalizer(() => Scope.close(serverScope, Exit.void).pipe(Effect.orDie));
    return computePort;
  }),
);

const StorageRpcClientLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* StorageTestPort;
    const protocol = RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(NodeHttpClient.layer),
    );
    return Layer.scoped(StorageRpcClient, RpcClient.make(StorageRpcs)).pipe(Layer.provide(protocol));
  }),
);

const ComputeRpcClientLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const port = yield* ComputeTestPort;
    const protocol = RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${port}/rpc` }).pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(NodeHttpClient.layer),
    );
    return Layer.scoped(ComputeRpcClient, RpcClient.make(ComputeRpcs)).pipe(Layer.provide(protocol));
  }),
);

const FullComputeTestLayer = ComputeTestLayer.pipe(Layer.provide(StorageTestLayer));

export const E2ELayer = Layer.mergeAll(
  StorageTestLayer,
  FullComputeTestLayer,
  StorageRpcClientLayer.pipe(Layer.provide(StorageTestLayer)),
  ComputeRpcClientLayer.pipe(Layer.provide(FullComputeTestLayer)),
  NodeHttpClient.layer,
).pipe(Layer.provide(NodeContext.layer));

// --- Auth flow using real client crypto ---
// Mirrors the exact sequence the browser client performs on registration + login.

export interface UserSession {
  sessionToken: string;
  dek: Uint8Array;
  dekBase64Url: string;
}

export const registerAndLogin = (username: string, password: string): Effect.Effect<UserSession, unknown, StorageRpcClient> =>
  Effect.gen(function* () {
    const client = yield* StorageRpcClient;

    const kdfParams = generateKdfParams();
    const masterKey = yield* deriveMasterKey(password, kdfParams);
    const kek = yield* deriveKek(masterKey);
    const authKey = yield* deriveAuthKey(masterKey);
    const dek = generateDek();
    const { encryptedDek, dekIv } = yield* wrapDek(dek, kek);

    const { totpUri } = yield* client.Register({ username, authKey, kdfParams, encryptedDek, dekIv });
    const totpSecret = new URL(totpUri).searchParams.get("secret")!;
    yield* client.ConfirmTotp({ username, totpCode: authenticator.generate(totpSecret) });

    const { sessionToken } = yield* client.Login({
      username,
      authKey,
      totpCode: authenticator.generate(totpSecret),
    });

    return { sessionToken, dek, dekBase64Url: bytesToBase64Url(dek) };
  });

// --- Upload helper via compute ---

export const uploadViaCompute = (
  computePort: number,
  session: UserSession,
  content: Uint8Array,
  opts: { name: string; format: "pdf" | "jpg" | "png" },
): Effect.Effect<string, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const res = yield* httpClient
      .execute(
        HttpClientRequest.post(`http://127.0.0.1:${computePort}/upload`).pipe(
          HttpClientRequest.setHeader(COMPUTE_SESSION_HEADER, session.sessionToken),
          HttpClientRequest.setHeader("x-dossier-dek", session.dekBase64Url),
          HttpClientRequest.setHeader("x-document-name", opts.name),
          HttpClientRequest.setHeader("x-document-format", opts.format),
          HttpClientRequest.bodyUint8Array(content),
        ),
      )
      .pipe(Effect.orDie);
    if (res.status !== 201) yield* Effect.die(new Error(`Upload failed: ${res.status}`));
    const json = (yield* res.json.pipe(Effect.orDie)) as { documentId: string };
    return json.documentId;
  });

// --- Stream collector ---

export const collectStream = (s: Stream.Stream<Uint8Array, unknown>): Effect.Effect<Uint8Array, unknown> =>
  Stream.runCollect(s).pipe(Effect.map((chunks) => new Uint8Array(Chunk.toArray(chunks).flatMap((b) => Array.from(b)))));
