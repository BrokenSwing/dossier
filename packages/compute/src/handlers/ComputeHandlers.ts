import {
  CollectionId,
  ComputeAuthContext,
  ComputeRpcs,
  DocumentId,
  InternalError,
  KeyRotationProgress,
  NotFoundError,
  STORAGE_SESSION_HEADER,
} from "@dossier/shared";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as Chunk from "effect/Chunk";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { createArchive } from "../services/Archive.js";
import { CryptoService } from "../services/Crypto.js";
import { WatermarkService } from "../services/Watermark.js";
import { StorageClient, StorageUrl } from "../StorageClient.js";

const collectStream = <E>(s: Stream.Stream<Uint8Array, E>): Effect.Effect<Uint8Array, E> =>
  Stream.runCollect(s).pipe(Effect.map((chunks) => new Uint8Array(Buffer.concat(Chunk.toReadonlyArray(chunks).map((c) => Buffer.from(c))))));

const mapStorageError = (e: unknown): NotFoundError | InternalError => (e instanceof NotFoundError ? e : new InternalError({ message: String(e) }));

// Paginates through all documents for the current user.
const listAllDocuments = (sessionToken: string) =>
  Effect.gen(function* () {
    const client = yield* StorageClient;
    const docs: Array<{
      id: DocumentId;
      name: string;
      format: "pdf" | "jpg" | "png";
      tags: readonly string[];
      collectionIds: readonly CollectionId[];
    }> = [];

    const go = (cursor: string | null): Effect.Effect<void, NotFoundError | InternalError, StorageClient> =>
      Effect.gen(function* () {
        const params = cursor !== null ? { cursor, limit: 100 } : { limit: 100 };
        const page = yield* client
          .ListDocuments(params, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
          .pipe(Effect.mapError(mapStorageError));
        for (const doc of page.documents) {
          docs.push({ id: doc.id, name: doc.name, format: doc.format, tags: doc.tags, collectionIds: doc.collectionIds });
        }
        if (page.nextCursor !== null) yield* go(page.nextCursor);
      });

    yield* go(null);
    return docs;
  });

const uploadEncryptedBlob = (
  blobKey: string,
  data: Uint8Array,
  sessionToken: string,
  storageUrl: string,
): Effect.Effect<void, InternalError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient
      .execute(
        HttpClientRequest.put(`${storageUrl}/blobs/${blobKey}`).pipe(
          HttpClientRequest.setHeader(STORAGE_SESSION_HEADER, sessionToken),
          HttpClientRequest.bodyUint8Array(data),
        ),
      )
      .pipe(Effect.mapError((e) => new InternalError({ message: `Blob PUT failed: ${String(e)}` })));
    if (response.status !== 204) {
      yield* Effect.fail(new InternalError({ message: `Blob upload returned HTTP ${response.status}` }));
    }
  });

export const computeHandlers = ComputeRpcs.toLayer({
  Preview: ({ dek, documentId }) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const { sessionToken } = yield* ComputeAuthContext;
        const client = yield* StorageClient;
        const crypto = yield* CryptoService;
        const dekBytes = Buffer.from(dek, "base64url");
        const encrypted = yield* collectStream(
          client.DownloadDocumentBlob({ documentId }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } }).pipe(Stream.mapError(mapStorageError)),
        );
        const plaintext = yield* crypto.decrypt(encrypted, dekBytes);
        return Stream.make(plaintext);
      }),
    ).pipe(Stream.flatten({ concurrency: 1 })),

  WatermarkPreview: ({ dek, documentId, watermarkText }) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const { sessionToken } = yield* ComputeAuthContext;
        const client = yield* StorageClient;
        const crypto = yield* CryptoService;
        const watermarkSvc = yield* WatermarkService;
        const dekBytes = Buffer.from(dek, "base64url");
        const [meta, encrypted] = yield* Effect.all([
          client.GetDocumentMeta({ documentId }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } }).pipe(Effect.mapError(mapStorageError)),
          collectStream(
            client
              .DownloadDocumentBlob({ documentId }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
              .pipe(Stream.mapError(mapStorageError)),
          ),
        ] as const);
        const plaintext = yield* crypto.decrypt(encrypted, dekBytes);
        const watermarked = yield* watermarkSvc.apply(plaintext, meta.format, { text: watermarkText });
        return Stream.make(watermarked);
      }),
    ).pipe(Stream.flatten({ concurrency: 1 })),

  Export: ({ dek, docIds, exportFormat, archivePaths, watermarkText }) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const { sessionToken } = yield* ComputeAuthContext;
        const client = yield* StorageClient;
        const crypto = yield* CryptoService;
        const watermarkSvc = yield* WatermarkService;
        const dekBytes = Buffer.from(dek, "base64url");
        const entries = yield* Effect.forEach(
          docIds,
          (docId) =>
            Effect.gen(function* () {
              const [meta, encrypted] = yield* Effect.all([
                client
                  .GetDocumentMeta({ documentId: docId }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
                  .pipe(Effect.mapError(mapStorageError)),
                collectStream(
                  client
                    .DownloadDocumentBlob({ documentId: docId }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
                    .pipe(Stream.mapError(mapStorageError)),
                ),
              ] as const);
              let content = yield* crypto.decrypt(encrypted, dekBytes);
              if (watermarkText != null && watermarkText.length > 0) {
                content = yield* watermarkSvc.apply(content, meta.format, { text: watermarkText });
              }
              const name = archivePaths?.[docId as string] ?? `${meta.name}.${meta.format}`;
              return { name, content };
            }),
          { concurrency: 5 },
        );
        const archiveBuffer = yield* createArchive(entries, exportFormat);
        return Stream.make(archiveBuffer);
      }),
    ).pipe(Stream.flatten({ concurrency: 1 })),

  RotateKey: ({ oldDek, newDek, newEncryptedDek, newDekIv }) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const { sessionToken } = yield* ComputeAuthContext;
        const client = yield* StorageClient;
        const crypto = yield* CryptoService;
        const storageUrl = yield* StorageUrl;

        const oldDekBytes = Buffer.from(oldDek, "base64url");
        const newDekBytes = Buffer.from(newDek, "base64url");

        const docs = yield* listAllDocuments(sessionToken);
        const total = docs.length;

        const progressStream = Stream.zipWithIndex(Stream.fromIterable(docs)).pipe(
          Stream.mapEffect(
            ([doc, index]: [
              { id: DocumentId; name: string; format: "pdf" | "jpg" | "png"; tags: readonly string[]; collectionIds: readonly CollectionId[] },
              number,
            ]) =>
              Effect.gen(function* () {
                const encrypted = yield* collectStream(
                  client
                    .DownloadDocumentBlob({ documentId: doc.id }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
                    .pipe(Stream.mapError(mapStorageError)),
                );
                const plaintext = yield* crypto.decrypt(encrypted, oldDekBytes);
                const reEncrypted = yield* crypto
                  .encrypt(plaintext, newDekBytes)
                  .pipe(Effect.mapError((e) => new InternalError({ message: e.message })));

                const { documentId: newDocId, blobKey: newBlobKey } = yield* client
                  .CreateDocumentMeta(
                    { name: doc.name, format: doc.format, tagNames: [...doc.tags], collectionIds: [...doc.collectionIds] },
                    { headers: { [STORAGE_SESSION_HEADER]: sessionToken } },
                  )
                  .pipe(Effect.mapError(mapStorageError));

                yield* uploadEncryptedBlob(newBlobKey, reEncrypted, sessionToken, storageUrl);
                yield* client
                  .ConfirmBlobUpload(
                    { documentId: newDocId, encryptedSize: reEncrypted.length },
                    { headers: { [STORAGE_SESSION_HEADER]: sessionToken } },
                  )
                  .pipe(Effect.mapError(mapStorageError));
                yield* client
                  .DeleteDocument({ documentId: doc.id }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
                  .pipe(Effect.mapError(mapStorageError));

                return new KeyRotationProgress({ processed: index + 1, total, currentDocumentId: doc.id, phase: "uploading" });
              }),
          ),
        );

        const finalizationStream = Stream.fromEffect(
          client.UpdateEncryptedDek({ newEncryptedDek, newDekIv }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } }).pipe(
            Effect.mapError(mapStorageError),
            Effect.map(() => new KeyRotationProgress({ processed: total, total, currentDocumentId: null, phase: "finalizing" })),
          ),
        );

        return Stream.concat(progressStream, finalizationStream);
      }),
    ).pipe(Stream.flatten({ concurrency: 1 })),
});
