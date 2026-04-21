import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  StorageCollectionRpcs,
  StorageAuth,
  AuthContext,
  NotFoundError,
  ConflictError,
  InternalError,
  CircularCollectionError,
  CollectionHasChildrenError,
} from "@dossier/shared";
import * as CollectionSql from "../sql/CollectionSql.js";
import { SqlClient } from "@effect/sql/SqlClient";

export const collectionHandlers = StorageCollectionRpcs.middleware(
  StorageAuth,
).toLayer({
  ListCollections: () =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      return yield* CollectionSql.listCollections(userId);
    }),

  GetCollection: ({ collectionId }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      const opt = yield* CollectionSql.findById(collectionId, userId);
      if (Option.isNone(opt)) {
        return yield* new NotFoundError({ message: "Collection not found" });
      }
      return opt.value;
    }),

  CreateCollection: ({ name, parentId }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;

      // Validate parent ownership
      if (parentId !== null) {
        const parentOpt = yield* CollectionSql.findById(parentId, userId);
        if (Option.isNone(parentOpt)) {
          return yield* new NotFoundError({ message: "Parent collection not found" });
        }
      } else {
        // D6: root-level name uniqueness
        const conflict = yield* CollectionSql.checkRootNameConflict(
          userId,
          name,
        );
        if (conflict) {
          return yield* new ConflictError({ message: "Collection name already exists at root" });
        }
      }

      return yield* CollectionSql.insertCollection({
        id: crypto.randomUUID(),
        user_id: userId,
        name,
        parent_id: parentId,
        watermark_text: null,
      });
    }),

  UpdateCollection: ({ collectionId, name, watermark }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      const opt = yield* CollectionSql.findById(collectionId, userId);
      if (Option.isNone(opt)) {
        return yield* new NotFoundError({ message: "Collection not found" });
      }
      const current = opt.value;

      // Check sibling name conflict if name is changing
      if (name !== undefined && name !== current.name) {
        if (current.parentId === null) {
          const conflict = yield* CollectionSql.checkRootNameConflict(
            userId,
            name,
            collectionId,
          );
          if (conflict) {
            return yield* new ConflictError({ message: "Collection name already exists at root" });
          }
        }
        // Non-root conflicts are handled by DB UNIQUE(user_id, parent_id, name)
      }

      return yield* CollectionSql.updateCollection(collectionId, userId, {
        ...(name !== undefined ? { name } : {}),
        ...(watermark !== undefined ? { watermark: watermark ?? null } : {}),
      });
    }),

  DeleteCollection: ({ collectionId, recursive }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const { userId } = yield* AuthContext;
      const opt = yield* CollectionSql.findById(collectionId, userId);
      if (Option.isNone(opt)) {
        return yield* new NotFoundError({ message: "Collection not found" });
      }

      if (!recursive) {
        const children = yield* sql<{ id: string }>`
          SELECT id FROM collections WHERE parent_id = ${collectionId} AND user_id = ${userId} LIMIT 1
        `.pipe(
          Effect.mapError(
            (e) =>
              new InternalError({
                message: `DeleteCollection check: ${String(e)}`,
              }),
          ),
        );
        if (children.length > 0) {
          return yield* new CollectionHasChildrenError({ message: "Collection has children; use recursive=true" });
        }
        // Simple delete (FK RESTRICT protects children from orphaning)
        yield* sql`
          DELETE FROM collections WHERE id = ${collectionId} AND user_id = ${userId}
        `.pipe(
          Effect.mapError(
            (e) =>
              new InternalError({
                message: `DeleteCollection delete: ${String(e)}`,
              }),
          ),
        );
        return { deletedCount: 1 };
      }

      const count = yield* CollectionSql.deleteCollectionRecursive(
        collectionId,
        userId,
      );
      return { deletedCount: count };
    }),

  MoveCollection: ({ collectionId, newParentId }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      const opt = yield* CollectionSql.findById(collectionId, userId);
      if (Option.isNone(opt)) {
        return yield* new NotFoundError({ message: "Collection not found" });
      }

      if (newParentId !== null) {
        // Validate new parent ownership
        const parentOpt = yield* CollectionSql.findById(newParentId, userId);
        if (Option.isNone(parentOpt)) {
          return yield* new NotFoundError({
            message: "Target parent collection not found",
          });
        }

        // D7: circular detection
        const isCircular = yield* CollectionSql.checkCircular(
          collectionId,
          newParentId,
          userId,
        );
        if (isCircular) {
          return yield* new CircularCollectionError({ message: "Moving would create a circular reference" });
        }
      } else {
        // D6: root-level name conflict
        const conflict = yield* CollectionSql.checkRootNameConflict(
          userId,
          opt.value.name,
          collectionId,
        );
        if (conflict) {
          return yield* new ConflictError({ message: "Collection name already exists at root" });
        }
      }

      return yield* CollectionSql.updateCollection(collectionId, userId, {
        parent_id: newParentId,
      });
    }),

  AddDocumentToCollection: ({ collectionId, documentId }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const { userId } = yield* AuthContext;

      // Verify collection ownership
      const colOpt = yield* CollectionSql.findById(collectionId, userId);
      if (Option.isNone(colOpt)) {
        return yield* new NotFoundError({ message: "Collection not found" });
      }

      // Verify document ownership
      const docRows = yield* sql<{ id: string }>`
        SELECT id FROM documents WHERE id = ${documentId} AND user_id = ${userId} LIMIT 1
      `.pipe(
        Effect.mapError(
          (e) =>
            new InternalError({
              message: `AddDocumentToCollection: ${String(e)}`,
            }),
        ),
      );
      if (!docRows[0]) {
        return yield* new NotFoundError({ message: "Document not found" });
      }

      yield* CollectionSql.addDocumentToCollection(collectionId, documentId);
    }),

  RemoveDocumentFromCollection: ({ collectionId, documentId }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      const count = yield* CollectionSql.removeDocumentFromCollection(
        collectionId,
        documentId,
        userId,
      );
      if (count === 0) {
        return yield* new NotFoundError({ message: "Document not in collection" });
      }
    }),
});
