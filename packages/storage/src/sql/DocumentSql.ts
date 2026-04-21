import {
  DocumentId,
  CollectionId,
  TagId,
  UserId,
  DocumentMeta,
  DocumentListPage,
  ListDocumentsParams,
  InternalError,
  NotFoundError,
} from "@dossier/shared";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

interface DocumentRow {
  id: string;
  name: string;
  format: string;
  blob_key: string;
  encrypted_size: number;
  created_at: string;
  updated_at: string;
}

const mapSqlError = (op: string) => (e: unknown) => new InternalError({ message: `${op} failed: ${String(e)}` });

export const insertDocument = (doc: { id: string; user_id: string; name: string; format: string; blob_key: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      INSERT INTO documents (id, user_id, name, format, blob_key)
      VALUES (${doc.id}, ${doc.user_id}, ${doc.name}, ${doc.format}, ${doc.blob_key})
    `.pipe(Effect.mapError(mapSqlError("insertDocument")));
  });

export const upsertTag = (userId: string, name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    // Try insert, ignore conflict, then fetch
    yield* sql`
      INSERT OR IGNORE INTO tags (id, user_id, name)
      VALUES (lower(hex(randomblob(8))), ${userId}, ${name})
    `.pipe(Effect.mapError(mapSqlError("upsertTag insert")));
    const rows = yield* sql<{ id: string }>`
      SELECT id FROM tags WHERE user_id = ${userId} AND name = ${name} COLLATE NOCASE LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("upsertTag select")));
    const first = rows[0];
    if (!first) return yield* new InternalError({ message: "upsertTag: tag not found after insert" });
    return first.id as TagId;
  });

export const insertDocumentTag = (documentId: string, tagId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      VALUES (${documentId}, ${tagId})
    `.pipe(Effect.mapError(mapSqlError("insertDocumentTag")));
  });

export const insertDocumentCollection = (documentId: string, collectionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO collection_documents (collection_id, document_id)
      VALUES (${collectionId}, ${documentId})
    `.pipe(Effect.mapError(mapSqlError("insertDocumentCollection")));
  });

const fetchDocumentTags = (documentId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return yield* sql<{ name: string }>`
      SELECT t.name FROM tags t
      JOIN document_tags dt ON dt.tag_id = t.id
      WHERE dt.document_id = ${documentId}
      ORDER BY t.name COLLATE NOCASE
    `.pipe(Effect.mapError(mapSqlError("fetchDocumentTags")));
  });

const fetchDocumentCollections = (documentId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return yield* sql<{ collection_id: string }>`
      SELECT collection_id FROM collection_documents
      WHERE document_id = ${documentId}
    `.pipe(Effect.mapError(mapSqlError("fetchDocumentCollections")));
  });

const rowToMeta = (row: DocumentRow, tags: string[], collectionIds: string[]): DocumentMeta =>
  new DocumentMeta({
    id: row.id as DocumentId,
    name: row.name,
    format: row.format as DocumentMeta["format"],
    encryptedSize: row.encrypted_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags,
    collectionIds: collectionIds.map((c) => c as CollectionId),
  });

export const findById = (id: DocumentId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<DocumentRow>`
      SELECT id, name, format, blob_key, encrypted_size, created_at, updated_at
      FROM documents
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("findById")));
    const row = rows[0];
    if (!row) return Option.none<DocumentMeta>();
    const [tags, colls] = yield* Effect.all([fetchDocumentTags(id), fetchDocumentCollections(id)]);
    return Option.some(
      rowToMeta(
        row,
        tags.map((t) => t.name),
        colls.map((c) => c.collection_id),
      ),
    );
  });

export const findByBlobKey = (blobKey: string, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<DocumentRow>`
      SELECT id, name, format, blob_key, encrypted_size, created_at, updated_at
      FROM documents
      WHERE blob_key = ${blobKey} AND user_id = ${userId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("findByBlobKey")));
    const row = rows[0];
    return Option.fromNullable(row);
  });

export const confirmBlobUpload = (documentId: DocumentId, userId: UserId, encryptedSize: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      UPDATE documents
      SET encrypted_size = ${encryptedSize},
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ${documentId} AND user_id = ${userId} AND encrypted_size = 0
    `.pipe(Effect.mapError(mapSqlError("confirmBlobUpload")));
  });

export const renameDocument = (documentId: DocumentId, userId: UserId, name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const result = yield* sql`
      UPDATE documents
      SET name = ${name}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ${documentId} AND user_id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("renameDocument")));
    if ((result as unknown as { rowsAffected?: number }).rowsAffected === 0) {
      return yield* new NotFoundError({ message: "Document not found" });
    }
  });

export const deleteDocument = (documentId: DocumentId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<{ blob_key: string }>`
      SELECT blob_key FROM documents WHERE id = ${documentId} AND user_id = ${userId} LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("deleteDocument select")));
    const row = rows[0];
    if (!row) return yield* new NotFoundError({ message: "Document not found" });
    yield* sql`
      DELETE FROM documents WHERE id = ${documentId} AND user_id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("deleteDocument delete")));
    return row.blob_key;
  });

export const updateDocumentTags = (documentId: DocumentId, userId: UserId, tagNames: readonly string[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    // Verify document ownership
    const docRows = yield* sql<{ id: string }>`
      SELECT id FROM documents WHERE id = ${documentId} AND user_id = ${userId} LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("updateDocumentTags verify")));
    if (!docRows[0]) return yield* new NotFoundError({ message: "Document not found" });

    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Upsert all tags and collect their IDs
          const tagIds = yield* Effect.all(
            tagNames.map((name) => upsertTag(userId, name)),
            { concurrency: "unbounded" },
          );

          // Replace document_tags
          yield* sql`DELETE FROM document_tags WHERE document_id = ${documentId}`.pipe(Effect.mapError(mapSqlError("updateDocumentTags delete")));

          if (tagIds.length > 0) {
            yield* Effect.all(
              tagIds.map((tagId) => insertDocumentTag(documentId, tagId)),
              { concurrency: "unbounded" },
            );
          }

          // Return updated tags
          const tags = yield* fetchDocumentTags(documentId);
          return tags.map((t) => t.name);
        }),
      )
      .pipe(Effect.mapError((e) => new InternalError({ message: `updateDocumentTags tx: ${String(e)}` })));
  });

export const updateDocumentCollections = (documentId: DocumentId, userId: UserId, collectionIds: readonly CollectionId[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const docRows = yield* sql<{ id: string }>`
      SELECT id FROM documents WHERE id = ${documentId} AND user_id = ${userId} LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("updateDocumentCollections verify")));
    if (!docRows[0]) return yield* new NotFoundError({ message: "Document not found" });

    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM collection_documents WHERE document_id = ${documentId}`.pipe(
            Effect.mapError(mapSqlError("updateDocumentCollections delete")),
          );

          if (collectionIds.length > 0) {
            yield* Effect.all(
              collectionIds.map((colId) => insertDocumentCollection(documentId, colId)),
              { concurrency: "unbounded" },
            );
          }
        }),
      )
      .pipe(Effect.mapError((e) => new InternalError({ message: `updateDocumentCollections tx: ${String(e)}` })));
  });

// Keyset cursor pagination (D5)
type SortField = "name" | "createdAt" | "updatedAt";
type SortDir = "asc" | "desc";

interface Cursor {
  v: string;
  id: string;
}

const decodeCursor = (cursor: string): Cursor | null => {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
  } catch {
    return null;
  }
};

const encodeCursor = (v: string, id: string): string => Buffer.from(JSON.stringify({ v, id })).toString("base64url");

const colFor = (field: SortField) => {
  if (field === "name") return "name";
  if (field === "createdAt") return "created_at";
  return "updated_at";
};

export const listDocuments = (userId: UserId, params: ListDocumentsParams) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const { sortField, sortDirection, nameFilter, tagFilter, collectionFilter, cursor, limit } = params;
    const col = colFor(sortField);
    const dir = sortDirection === "asc" ? "ASC" : "DESC";
    const fetchLimit = limit + 1;

    // Build base conditions
    let rows: ReadonlyArray<DocumentRow>;

    if (cursor) {
      const c = decodeCursor(cursor);
      if (!c) return yield* new InternalError({ message: "Invalid cursor" });

      const { v, id } = c;
      // Keyset: (col, id) > (v, id) for ASC, < for DESC
      if (tagFilter && tagFilter.length > 0) {
        const tagIds = tagFilter as readonly string[];
        rows = yield* sql<DocumentRow>`
          SELECT DISTINCT d.id, d.name, d.format, d.blob_key, d.encrypted_size, d.created_at, d.updated_at
          FROM documents d
          JOIN document_tags dt ON dt.document_id = d.id
          WHERE d.user_id = ${userId}
            ${nameFilter ? sql`AND d.name LIKE ${"%" + nameFilter + "%"}` : sql``}
            AND dt.tag_id IN ${sql.in(tagIds)}
            ${collectionFilter ? sql`AND d.id IN (SELECT document_id FROM collection_documents WHERE collection_id = ${collectionFilter})` : sql``}
            AND (${sql.unsafe(col)} ${dir === "ASC" ? sql.unsafe(">") : sql.unsafe("<")} ${v}
              OR (${sql.unsafe(col)} = ${v} AND d.id ${dir === "ASC" ? sql.unsafe(">") : sql.unsafe("<")} ${id}))
          ORDER BY d.${sql.unsafe(col)} ${sql.unsafe(dir)}, d.id ${sql.unsafe(dir)}
          LIMIT ${fetchLimit}
        `.pipe(Effect.mapError(mapSqlError("listDocuments")));
      } else {
        rows = yield* sql<DocumentRow>`
          SELECT d.id, d.name, d.format, d.blob_key, d.encrypted_size, d.created_at, d.updated_at
          FROM documents d
          WHERE d.user_id = ${userId}
            ${nameFilter ? sql`AND d.name LIKE ${"%" + nameFilter + "%"}` : sql``}
            ${collectionFilter ? sql`AND d.id IN (SELECT document_id FROM collection_documents WHERE collection_id = ${collectionFilter})` : sql``}
            AND (${sql.unsafe(col)} ${dir === "ASC" ? sql.unsafe(">") : sql.unsafe("<")} ${v}
              OR (${sql.unsafe(col)} = ${v} AND d.id ${dir === "ASC" ? sql.unsafe(">") : sql.unsafe("<")} ${id}))
          ORDER BY d.${sql.unsafe(col)} ${sql.unsafe(dir)}, d.id ${sql.unsafe(dir)}
          LIMIT ${fetchLimit}
        `.pipe(Effect.mapError(mapSqlError("listDocuments")));
      }
    } else {
      if (tagFilter && tagFilter.length > 0) {
        const tagIds = tagFilter as readonly string[];
        rows = yield* sql<DocumentRow>`
          SELECT DISTINCT d.id, d.name, d.format, d.blob_key, d.encrypted_size, d.created_at, d.updated_at
          FROM documents d
          JOIN document_tags dt ON dt.document_id = d.id
          WHERE d.user_id = ${userId}
            ${nameFilter ? sql`AND d.name LIKE ${"%" + nameFilter + "%"}` : sql``}
            AND dt.tag_id IN ${sql.in(tagIds)}
            ${collectionFilter ? sql`AND d.id IN (SELECT document_id FROM collection_documents WHERE collection_id = ${collectionFilter})` : sql``}
          ORDER BY d.${sql.unsafe(col)} ${sql.unsafe(dir)}, d.id ${sql.unsafe(dir)}
          LIMIT ${fetchLimit}
        `.pipe(Effect.mapError(mapSqlError("listDocuments")));
      } else {
        rows = yield* sql<DocumentRow>`
          SELECT d.id, d.name, d.format, d.blob_key, d.encrypted_size, d.created_at, d.updated_at
          FROM documents d
          WHERE d.user_id = ${userId}
            ${nameFilter ? sql`AND d.name LIKE ${"%" + nameFilter + "%"}` : sql``}
            ${collectionFilter ? sql`AND d.id IN (SELECT document_id FROM collection_documents WHERE collection_id = ${collectionFilter})` : sql``}
          ORDER BY d.${sql.unsafe(col)} ${sql.unsafe(dir)}, d.id ${sql.unsafe(dir)}
          LIMIT ${fetchLimit}
        `.pipe(Effect.mapError(mapSqlError("listDocuments")));
      }
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? (() => {
            const last = pageRows[pageRows.length - 1]!;
            const v = col === "name" ? last.name : col === "created_at" ? last.created_at : last.updated_at;
            return encodeCursor(v, last.id);
          })()
        : null;

    // Fetch tags and collections for each document
    const docIds = pageRows.map((r) => r.id);

    let allTags: ReadonlyArray<{ readonly document_id: string; readonly name: string }> = [];
    let allCols: ReadonlyArray<{ readonly document_id: string; readonly collection_id: string }> = [];

    if (docIds.length > 0) {
      allTags = yield* sql<{ document_id: string; name: string }>`
        SELECT dt.document_id, t.name
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id IN ${sql.in(docIds)}
      `.pipe(Effect.mapError(mapSqlError("listDocuments tags")));

      allCols = yield* sql<{ document_id: string; collection_id: string }>`
        SELECT document_id, collection_id
        FROM collection_documents
        WHERE document_id IN ${sql.in(docIds)}
      `.pipe(Effect.mapError(mapSqlError("listDocuments collections")));
    }

    const tagsByDoc = new Map<string, string[]>();
    for (const t of allTags) {
      const arr = tagsByDoc.get(t.document_id) ?? [];
      arr.push(t.name);
      tagsByDoc.set(t.document_id, arr);
    }
    const colsByDoc = new Map<string, string[]>();
    for (const c of allCols) {
      const arr = colsByDoc.get(c.document_id) ?? [];
      arr.push(c.collection_id);
      colsByDoc.set(c.document_id, arr);
    }

    const documents = pageRows.map((row) => rowToMeta(row, tagsByDoc.get(row.id) ?? [], colsByDoc.get(row.id) ?? []));

    return new DocumentListPage({ documents, nextCursor });
  });
