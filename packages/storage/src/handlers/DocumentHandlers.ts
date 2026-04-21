import { SqlClient } from "@effect/sql/SqlClient"
import * as crypto from "node:crypto"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import {
  StorageDocumentRpcs,
  StorageAuth,
  AuthContext,
  InternalError,
  NotFoundError,
  DocumentId,
  CollectionId,
  Tag,
  TagId,
} from "@dossier/shared"
import { BlobStore } from "../services/BlobStore.js"
import * as DocumentSql from "../sql/DocumentSql.js"

export const documentHandlers = StorageDocumentRpcs.middleware(StorageAuth).toLayer({
  ListDocuments: (params) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      return yield* DocumentSql.listDocuments(userId, params)
    }),

  GetDocumentMeta: ({ documentId }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      const metaOpt = yield* DocumentSql.findById(documentId, userId)
      if (Option.isNone(metaOpt)) {
        return yield* new NotFoundError({ message: "Document not found" })
      }
      return metaOpt.value
    }),

  CreateDocumentMeta: ({ name, format, tagNames, collectionIds }) =>
    Effect.gen(function*() {
      const sql = yield* SqlClient
      const { userId } = yield* AuthContext
      const documentId = crypto.randomUUID() as DocumentId
      const blobKey = crypto.randomUUID()

      yield* sql.withTransaction(
        Effect.gen(function*() {
          yield* DocumentSql.insertDocument({
            id: documentId,
            user_id: userId,
            name,
            format,
            blob_key: blobKey,
          })

          // Upsert tags
          const tagIds = yield* Effect.all(
            tagNames.map((n) => DocumentSql.upsertTag(userId, n)),
            { concurrency: "unbounded" }
          )
          yield* Effect.all(
            tagIds.map((tagId) => DocumentSql.insertDocumentTag(documentId, tagId)),
            { concurrency: "unbounded" }
          )

          // Link collections
          yield* Effect.all(
            collectionIds.map((colId) => DocumentSql.insertDocumentCollection(documentId, colId)),
            { concurrency: "unbounded" }
          )
        })
      ).pipe(Effect.mapError((e) => new InternalError({ message: `CreateDocumentMeta: ${String(e)}` })))

      return { documentId, blobKey }
    }),

  ConfirmBlobUpload: ({ documentId, encryptedSize }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      yield* DocumentSql.confirmBlobUpload(documentId, userId, encryptedSize)
    }),

  DownloadDocumentBlob: ({ documentId }) =>
    // For stream: true RPCs, return a Stream directly
    Stream.fromEffect(
      Effect.gen(function*() {
        const sql = yield* SqlClient
        const { userId } = yield* AuthContext
        const blobStore = yield* BlobStore

        const rows = yield* sql<{ blob_key: string }>`
          SELECT blob_key FROM documents WHERE id = ${documentId} AND user_id = ${userId} LIMIT 1
        `.pipe(Effect.mapError((e) => new InternalError({ message: `blobKey lookup: ${String(e)}` })))

        const blobKey = rows[0]?.blob_key
        if (!blobKey) {
          return yield* new NotFoundError({ message: "Document not found" })
        }

        return blobStore.readStream(blobKey)
      })
    ).pipe(Stream.flatten({ concurrency: 1 })),

  RenameDocument: ({ documentId, name }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      yield* DocumentSql.renameDocument(documentId, userId, name)
    }),

  DeleteDocument: ({ documentId }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      const blobStore = yield* BlobStore
      const blobKey = yield* DocumentSql.deleteDocument(documentId, userId)
      yield* blobStore.delete(blobKey)
    }),

  UpdateDocumentTags: ({ documentId, tagNames }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      const sql = yield* SqlClient
      const tagNames2 = yield* DocumentSql.updateDocumentTags(documentId, userId, tagNames)

      // Fetch full Tag objects with document counts
      const tagRows = yield* sql<{ id: string; name: string; document_count: number }>`
        SELECT t.id, t.name, COUNT(dt.document_id) AS document_count
        FROM tags t
        LEFT JOIN document_tags dt ON dt.tag_id = t.id
        WHERE t.user_id = ${userId} AND t.name IN ${sql.in(tagNames2.length > 0 ? tagNames2 : ["__none__"])}
        GROUP BY t.id
      `.pipe(Effect.mapError((e) => new InternalError({ message: `UpdateDocumentTags fetch: ${String(e)}` })))

      return tagRows.map(
        (r) => new Tag({ id: r.id as TagId, name: r.name, documentCount: r.document_count })
      )
    }),

  UpdateDocumentCollections: ({ documentId, collectionIds }) =>
    Effect.gen(function*() {
      const { userId } = yield* AuthContext
      yield* DocumentSql.updateDocumentCollections(documentId, userId, collectionIds)
    }),
})
