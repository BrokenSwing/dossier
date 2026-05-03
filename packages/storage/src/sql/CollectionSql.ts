import { Collection, CollectionId, DocumentId, UserId, WatermarkConfig, InternalError, NotFoundError, ConflictError } from "@dossier/shared";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

interface CollectionRow {
  id: string;
  name: string;
  parent_id: string | null;
  watermark_text: string | null;
  created_at: string;
}

const rowToCollection = (r: CollectionRow): Collection =>
  new Collection({
    id: r.id as CollectionId,
    name: r.name,
    parentId: r.parent_id as CollectionId | null,
    watermark: r.watermark_text !== null ? new WatermarkConfig({ text: r.watermark_text }) : null,
    createdAt: r.created_at,
  });

const mapSqlError = (op: string) => (e: unknown) => new InternalError({ message: `${op} failed: ${String(e)}` });

export const listCollections = (userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<CollectionRow>`
      SELECT id, name, parent_id, watermark_text, created_at
      FROM collections
      WHERE user_id = ${userId}
      ORDER BY name COLLATE NOCASE
    `.pipe(Effect.mapError(mapSqlError("listCollections")));
    return rows.map(rowToCollection);
  });

export const findById = (id: CollectionId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<CollectionRow>`
      SELECT id, name, parent_id, watermark_text, created_at
      FROM collections
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("findById")));
    return Option.fromNullable(rows[0]).pipe(Option.map(rowToCollection));
  });

// D6: SQLite NULL != NULL in UNIQUE, so check root-level conflicts manually
export const checkRootNameConflict = (userId: UserId, name: string, excludeId?: CollectionId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = excludeId
      ? yield* sql<{ id: string }>`
          SELECT id FROM collections
          WHERE user_id = ${userId} AND parent_id IS NULL
            AND name = ${name} COLLATE NOCASE AND id != ${excludeId}
          LIMIT 1
        `.pipe(Effect.mapError(mapSqlError("checkRootNameConflict")))
      : yield* sql<{ id: string }>`
          SELECT id FROM collections
          WHERE user_id = ${userId} AND parent_id IS NULL
            AND name = ${name} COLLATE NOCASE
          LIMIT 1
        `.pipe(Effect.mapError(mapSqlError("checkRootNameConflict")));
    return rows.length > 0;
  });

// D7: CTE walking ancestors of newParentId; reject if collectionId appears
export const checkCircular = (collectionId: CollectionId, newParentId: CollectionId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<{ id: string }>`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM collections WHERE id = ${newParentId} AND user_id = ${userId}
        UNION ALL
        SELECT c.id, c.parent_id FROM collections c
        JOIN ancestors a ON c.id = a.parent_id
        WHERE c.user_id = ${userId}
      )
      SELECT id FROM ancestors WHERE id = ${collectionId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("checkCircular")));
    return rows.length > 0;
  });

export const insertCollection = (col: { id: string; user_id: string; name: string; parent_id: string | null; watermark_text: string | null }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      INSERT INTO collections (id, user_id, name, parent_id, watermark_text)
      VALUES (${col.id}, ${col.user_id}, ${col.name}, ${col.parent_id ?? null}, ${col.watermark_text ?? null})
    `.pipe(Effect.mapError(mapSqlError("insertCollection")));
    const rows = yield* sql<CollectionRow>`
      SELECT id, name, parent_id, watermark_text, created_at
      FROM collections WHERE id = ${col.id}
    `.pipe(Effect.mapError(mapSqlError("insertCollection fetch")));
    const row = rows[0];
    if (!row) return yield* new InternalError({ message: "insertCollection: not found after insert" });
    return rowToCollection(row);
  });

export const updateCollection = (
  id: CollectionId,
  userId: UserId,
  patch: { name?: string; watermark?: WatermarkConfig | null; parent_id?: string | null },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (patch.name !== undefined) {
      yield* sql`
        UPDATE collections SET name = ${patch.name} WHERE id = ${id} AND user_id = ${userId}
      `.pipe(Effect.mapError(mapSqlError("updateCollection name")));
    }
    if ("watermark" in patch) {
      const wt = patch.watermark?.text ?? null;
      yield* sql`
        UPDATE collections SET watermark_text = ${wt} WHERE id = ${id} AND user_id = ${userId}
      `.pipe(Effect.mapError(mapSqlError("updateCollection watermark")));
    }
    if ("parent_id" in patch) {
      yield* sql`
        UPDATE collections SET parent_id = ${patch.parent_id ?? null} WHERE id = ${id} AND user_id = ${userId}
      `.pipe(Effect.mapError(mapSqlError("updateCollection parent")));
    }
    const rows = yield* sql<CollectionRow>`
      SELECT id, name, parent_id, watermark_text, created_at
      FROM collections WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("updateCollection fetch")));
    const row = rows[0];
    if (!row) return yield* new NotFoundError({ message: "Collection not found" });
    return rowToCollection(row);
  });

// D8: Recursive CTE delete, PRAGMA foreign_keys toggle
export const deleteCollectionRecursive = (id: CollectionId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    // Collect all descendant IDs including the root
    const allIds = yield* sql<{ id: string }>`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM collections WHERE id = ${id} AND user_id = ${userId}
        UNION ALL
        SELECT c.id FROM collections c
        JOIN descendants d ON c.parent_id = d.id
        WHERE c.user_id = ${userId}
      )
      SELECT id FROM descendants
    `.pipe(Effect.mapError(mapSqlError("deleteCollectionRecursive collect")));

    const ids = allIds.map((r) => r.id);
    if (ids.length === 0) return 0;

    // PRAGMA foreign_keys cannot be set inside a transaction; toggle it outside.
    yield* sql.unsafe("PRAGMA foreign_keys = OFF").pipe(Effect.mapError(mapSqlError("deleteCollectionRecursive disable_fk")));
    yield* sql
      .withTransaction(
        sql`
        DELETE FROM collections WHERE id IN ${sql.in(ids)} AND user_id = ${userId}
      `.pipe(Effect.mapError(mapSqlError("deleteCollectionRecursive delete"))),
      )
      .pipe(
        Effect.mapError((e) => new InternalError({ message: `deleteCollectionRecursive tx: ${String(e)}` })),
        Effect.ensuring(sql.unsafe("PRAGMA foreign_keys = ON").pipe(Effect.ignore)),
      );

    return ids.length;
  });

export const addDocumentToCollection = (collectionId: CollectionId, documentId: DocumentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql`
      INSERT INTO collection_documents (collection_id, document_id)
      VALUES (${collectionId}, ${documentId})
    `.pipe(
      Effect.mapError((e) => {
        const msg = String(e);
        if (msg.includes("UNIQUE") || msg.includes("unique")) {
          return new ConflictError({ message: "Document already in collection" });
        }
        return new InternalError({ message: `addDocumentToCollection: ${msg}` });
      }),
    );
  });

export const removeDocumentFromCollection = (collectionId: CollectionId, documentId: DocumentId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    // Check before delete to return 0 rows
    const rows = yield* sql<{ collection_id: string }>`
      SELECT cd.collection_id FROM collection_documents cd
      JOIN collections c ON c.id = cd.collection_id
      WHERE cd.collection_id = ${collectionId}
        AND cd.document_id = ${documentId}
        AND c.user_id = ${userId}
      LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("removeDocumentFromCollection check")));
    if (rows.length === 0) return 0;
    yield* sql`
      DELETE FROM collection_documents
      WHERE collection_id = ${collectionId} AND document_id = ${documentId}
    `.pipe(Effect.mapError(mapSqlError("removeDocumentFromCollection delete")));
    return 1;
  });
