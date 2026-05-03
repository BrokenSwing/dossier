import { type CollectionId, ComputeAuth, type DocumentId, NotFoundError } from "@dossier/shared";
import * as HttpClient from "@effect/platform/HttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { CryptoService, CryptoServiceLive } from "../../src/services/Crypto.js";
import { WatermarkService } from "../../src/services/Watermark.js";
import { StorageClient, StorageUrl } from "../../src/StorageClient.js";

export const TEST_SESSION_TOKEN = "test-session-token";

export const FakeComputeAuthLayer = Layer.succeed(
  ComputeAuth,
  ComputeAuth.of((_) => Effect.succeed({ sessionToken: TEST_SESSION_TOKEN })),
);

export const FakeWatermarkServiceLayer = Layer.succeed(
  WatermarkService,
  WatermarkService.of({
    apply: (content, _format, _config) => Effect.succeed(content),
  }),
);

export const FakeStorageUrlLayer = Layer.succeed(StorageUrl, "http://fake-storage");

export const FakeHttpClientLayer = Layer.succeed(HttpClient.HttpClient, {
  execute: () => Effect.succeed({ status: 204 } as any),
} as any);

export type FakeDocument = {
  documentId: DocumentId;
  name: string;
  format: "pdf" | "jpg" | "png";
  tags: string[];
  collectionIds: CollectionId[];
  blob: Uint8Array;
};

export type FakeStorageState = {
  createdDocIds: DocumentId[];
  confirmedDocIds: DocumentId[];
  deletedDocIds: DocumentId[];
  updateDekPayload: { newEncryptedDek: string; newDekIv: string } | null;
};

export const makeFakeStorageClientLayer = (initialDocs: FakeDocument[]) => {
  const docs = new Map<string, FakeDocument>(initialDocs.map((d) => [d.documentId as string, d]));
  let idCounter = 0;

  const state: FakeStorageState = {
    createdDocIds: [],
    confirmedDocIds: [],
    deletedDocIds: [],
    updateDekPayload: null,
  };

  const layer = Layer.sync(
    StorageClient,
    () =>
      ({
        DownloadDocumentBlob: ({ documentId }: { documentId: DocumentId }, _opts?: unknown) => {
          const doc = docs.get(documentId as string);
          if (!doc) return Stream.fail(new NotFoundError({ message: `Document not found: ${documentId}` }));
          return Stream.succeed(doc.blob);
        },

        GetDocumentMeta: ({ documentId }: { documentId: DocumentId }, _opts?: unknown) => {
          const doc = docs.get(documentId as string);
          if (!doc) return Effect.fail(new NotFoundError({ message: `Document not found: ${documentId}` }));
          return Effect.succeed({
            id: doc.documentId,
            name: doc.name,
            format: doc.format,
            encryptedSize: doc.blob.length,
            tags: doc.tags,
            collectionIds: doc.collectionIds,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
          } as any);
        },

        ListDocuments: (_payload: unknown, _opts?: unknown) =>
          Effect.succeed({
            documents: [...docs.values()].map((d) => ({
              id: d.documentId,
              name: d.name,
              format: d.format,
              encryptedSize: d.blob.length,
              tags: d.tags,
              collectionIds: d.collectionIds,
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            })),
            nextCursor: null,
          } as any),

        CreateDocumentMeta: (
          payload: { name: string; format: "pdf" | "jpg" | "png"; tagNames: string[]; collectionIds: CollectionId[] },
          _opts?: unknown,
        ) => {
          const documentId = `created-doc-${++idCounter}` as DocumentId;
          const blobKey = `blob-key-${idCounter}`;
          docs.set(documentId as string, {
            documentId,
            name: payload.name,
            format: payload.format,
            tags: payload.tagNames,
            collectionIds: payload.collectionIds,
            blob: new Uint8Array(0),
          });
          state.createdDocIds.push(documentId);
          return Effect.succeed({ documentId, blobKey });
        },

        ConfirmBlobUpload: ({ documentId }: { documentId: DocumentId }, _opts?: unknown) => {
          state.confirmedDocIds.push(documentId);
          return Effect.void;
        },

        DeleteDocument: ({ documentId }: { documentId: DocumentId }, _opts?: unknown) =>
          Effect.sync(() => {
            docs.delete(documentId as string);
            state.deletedDocIds.push(documentId);
          }),

        UpdateEncryptedDek: (payload: { newEncryptedDek: string; newDekIv: string }, _opts?: unknown) =>
          Effect.sync(() => {
            state.updateDekPayload = payload;
          }),
      }) as any,
  );

  return { layer, state };
};

export const encryptWithDek = (plaintext: Uint8Array, dek: Uint8Array): Effect.Effect<Uint8Array, never> =>
  Effect.gen(function* () {
    const crypto = yield* CryptoService;
    return yield* crypto.encrypt(plaintext, dek).pipe(Effect.orDie);
  }).pipe(Effect.provide(CryptoServiceLive));
