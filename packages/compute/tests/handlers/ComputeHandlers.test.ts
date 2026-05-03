import { type DocumentId, ComputeRpcs } from "@dossier/shared";
import * as RpcTest from "@effect/rpc/RpcTest";
import { describe, expect, it } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { computeHandlers } from "../../src/handlers/ComputeHandlers.js";
import { CryptoServiceLive } from "../../src/services/Crypto.js";
import {
  FakeComputeAuthLayer,
  FakeHttpClientLayer,
  FakeStorageUrlLayer,
  FakeWatermarkServiceLayer,
  type FakeDocument,
  encryptWithDek,
  makeFakeStorageClientLayer,
} from "./setup.js";

const DEK = new Uint8Array(32).fill(7);
const DEK_BASE64 = Buffer.from(DEK).toString("base64url");

const collectStream = <A, E>(s: Stream.Stream<A, E>): Effect.Effect<ReadonlyArray<A>, E> =>
  Stream.runCollect(s).pipe(Effect.map(Chunk.toReadonlyArray));

const makeTestLayer = (docs: FakeDocument[]) => {
  const { layer: FakeStorageLayer, state } = makeFakeStorageClientLayer(docs);
  const HandlerDeps = Layer.mergeAll(FakeStorageLayer, CryptoServiceLive, FakeWatermarkServiceLayer, FakeStorageUrlLayer, FakeHttpClientLayer);
  const TestLayer = Layer.mergeAll(computeHandlers.pipe(Layer.provide(HandlerDeps)), FakeComputeAuthLayer);
  return { TestLayer, state };
};

describe("Preview", () => {
  const plaintext = new TextEncoder().encode("preview document content");
  const DOC_ID = "doc-preview" as DocumentId;

  it.scoped("decrypts and streams the plaintext back", () =>
    Effect.gen(function* () {
      const encrypted = yield* encryptWithDek(plaintext, DEK);
      const { TestLayer } = makeTestLayer([{ documentId: DOC_ID, name: "test.pdf", format: "pdf", tags: [], collectionIds: [], blob: encrypted }]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const chunks = yield* collectStream(client.Preview({ dek: DEK_BASE64, documentId: DOC_ID }));
      const result = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      expect(result).toEqual(Buffer.from(plaintext));
    }),
  );

  it.scoped("fails when document does not exist", () =>
    Effect.gen(function* () {
      const { TestLayer } = makeTestLayer([]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const exit = yield* Effect.exit(collectStream(client.Preview({ dek: DEK_BASE64, documentId: "no-such-doc" as DocumentId })));
      expect(exit._tag).toBe("Failure");
    }),
  );
});

describe("WatermarkPreview", () => {
  const plaintext = new TextEncoder().encode("watermark document content");
  const DOC_ID = "doc-watermark" as DocumentId;

  it.scoped("returns content with watermark applied (fake watermark returns content unchanged)", () =>
    Effect.gen(function* () {
      const encrypted = yield* encryptWithDek(plaintext, DEK);
      const { TestLayer } = makeTestLayer([{ documentId: DOC_ID, name: "test.pdf", format: "pdf", tags: [], collectionIds: [], blob: encrypted }]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const chunks = yield* collectStream(client.WatermarkPreview({ dek: DEK_BASE64, documentId: DOC_ID, watermarkText: "CONFIDENTIAL" }));
      const result = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      expect(result).toEqual(Buffer.from(plaintext));
    }),
  );
});

describe("Export", () => {
  const content1 = new TextEncoder().encode("document one");
  const content2 = new TextEncoder().encode("document two");
  const DOC_ID_1 = "doc-export-1" as DocumentId;
  const DOC_ID_2 = "doc-export-2" as DocumentId;

  it.scoped("produces a valid zip archive for multiple documents", () =>
    Effect.gen(function* () {
      const [enc1, enc2] = yield* Effect.all([encryptWithDek(content1, DEK), encryptWithDek(content2, DEK)]);
      const { TestLayer } = makeTestLayer([
        { documentId: DOC_ID_1, name: "doc1", format: "pdf", tags: [], collectionIds: [], blob: enc1 },
        { documentId: DOC_ID_2, name: "doc2", format: "pdf", tags: [], collectionIds: [], blob: enc2 },
      ]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const chunks = yield* collectStream(client.Export({ dek: DEK_BASE64, docIds: [DOC_ID_1, DOC_ID_2], exportFormat: "zip" }));
      const result = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe(0x50); // ZIP magic: PK
      expect(result[1]).toBe(0x4b);
    }),
  );

  it.scoped("produces a valid tar.gz archive when requested", () =>
    Effect.gen(function* () {
      const encrypted = yield* encryptWithDek(content1, DEK);
      const { TestLayer } = makeTestLayer([{ documentId: DOC_ID_1, name: "doc1", format: "pdf", tags: [], collectionIds: [], blob: encrypted }]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const chunks = yield* collectStream(client.Export({ dek: DEK_BASE64, docIds: [DOC_ID_1], exportFormat: "tar.gz" }));
      const result = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      expect(result[0]).toBe(0x1f); // gzip magic
      expect(result[1]).toBe(0x8b);
    }),
  );
});

describe("RotateKey", () => {
  const NEW_DEK = new Uint8Array(32).fill(8);
  const NEW_DEK_BASE64 = Buffer.from(NEW_DEK).toString("base64url");
  const content = new TextEncoder().encode("rotate me");

  it.scoped("emits one progress event per document plus a finalizing event", () =>
    Effect.gen(function* () {
      const [enc1, enc2] = yield* Effect.all([encryptWithDek(content, DEK), encryptWithDek(content, DEK)]);
      const { TestLayer, state } = makeTestLayer([
        { documentId: "doc-rotate-1" as DocumentId, name: "doc1", format: "pdf", tags: [], collectionIds: [], blob: enc1 },
        { documentId: "doc-rotate-2" as DocumentId, name: "doc2", format: "pdf", tags: [], collectionIds: [], blob: enc2 },
      ]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const events = yield* collectStream(
        client.RotateKey({ oldDek: DEK_BASE64, newDek: NEW_DEK_BASE64, newEncryptedDek: "new-enc-dek", newDekIv: "new-dek-iv" }),
      );
      // 2 per-document uploading events + 1 finalizing
      expect(events).toHaveLength(3);
      expect(events[0]?.phase).toBe("uploading");
      expect(events[1]?.phase).toBe("uploading");
      expect(events[2]?.phase).toBe("finalizing");
      expect(events[2]?.processed).toBe(2);
      expect(events[2]?.total).toBe(2);
      // Verify UpdateEncryptedDek was called with the new values
      expect(state.updateDekPayload).toEqual({ newEncryptedDek: "new-enc-dek", newDekIv: "new-dek-iv" });
      // Each old doc was deleted and a new one created
      expect(state.createdDocIds).toHaveLength(2);
      expect(state.deletedDocIds).toHaveLength(2);
    }),
  );

  it.scoped("still calls UpdateEncryptedDek when there are no documents", () =>
    Effect.gen(function* () {
      const { TestLayer, state } = makeTestLayer([]);
      const client = yield* RpcTest.makeClient(ComputeRpcs).pipe(Effect.provide(TestLayer));
      const events = yield* collectStream(
        client.RotateKey({ oldDek: DEK_BASE64, newDek: NEW_DEK_BASE64, newEncryptedDek: "enc-dek", newDekIv: "dek-iv" }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.phase).toBe("finalizing");
      expect(state.updateDekPayload).toEqual({ newEncryptedDek: "enc-dek", newDekIv: "dek-iv" });
    }),
  );
});
