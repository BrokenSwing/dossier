import { StorageAuth, StorageCollectionRpcs, CollectionId, DocumentId } from "@dossier/shared";
import * as RpcTest from "@effect/rpc/RpcTest";
import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { collectionHandlers } from "../../src/handlers/CollectionHandlers.js";
import * as DocumentSql from "../../src/sql/DocumentSql.js";
import * as UserSql from "../../src/sql/UserSql.js";
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js";
import { FakeStorageAuthLayer } from "./setup.js";

const group = StorageCollectionRpcs.middleware(StorageAuth);

const BaseLayer = Layer.mergeAll(FakeStorageAuthLayer, TestSqlLayer);

const CollectionTestLayer = Layer.mergeAll(
  collectionHandlers.pipe(Layer.provide(BaseLayer)),
  BaseLayer,
  Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(Layer.provide(TestSqlLayer)),
);

layer(CollectionTestLayer)("CollectionHandlers", (it) => {
  describe("ListCollections", () => {
    it.scoped("returns empty array when user has no collections", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const cols = yield* client.ListCollections();
        expect(cols).toHaveLength(0);
      }),
    );
  });

  describe("CreateCollection", () => {
    it.scoped("creates a root-level collection", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "Root-A", parentId: null });
        expect(col.name).toBe("Root-A");
        expect(col.parentId).toBeNull();
      }),
    );

    it.scoped("returns ConflictError for duplicate root name", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        yield* client.CreateCollection({ name: "DupRoot", parentId: null });
        const exit = yield* Effect.exit(client.CreateCollection({ name: "DupRoot", parentId: null }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("creates a child collection under a parent", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const parent = yield* client.CreateCollection({ name: "Parent-X", parentId: null });
        const child = yield* client.CreateCollection({ name: "Child-X", parentId: parent.id });
        expect(child.parentId).toBe(parent.id);
      }),
    );

    it.scoped("returns NotFoundError when parent does not exist", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const exit = yield* Effect.exit(client.CreateCollection({ name: "Orphan", parentId: "no-such-parent" as CollectionId }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("GetCollection", () => {
    it.scoped("returns the collection when found", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const created = yield* client.CreateCollection({ name: "GetMe", parentId: null });
        const fetched = yield* client.GetCollection({ collectionId: created.id });
        expect(fetched.id).toBe(created.id);
        expect(fetched.name).toBe("GetMe");
      }),
    );

    it.scoped("returns NotFoundError for unknown id", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const exit = yield* Effect.exit(client.GetCollection({ collectionId: "unknown-col" as CollectionId }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("UpdateCollection", () => {
    it.scoped("renames a collection", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "OldName", parentId: null });
        const updated = yield* client.UpdateCollection({ collectionId: col.id, name: "NewName" });
        expect(updated.name).toBe("NewName");
      }),
    );

    it.scoped("returns ConflictError when renaming to an existing root name", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        yield* client.CreateCollection({ name: "TakenName", parentId: null });
        const col = yield* client.CreateCollection({ name: "ToRename", parentId: null });
        const exit = yield* Effect.exit(client.UpdateCollection({ collectionId: col.id, name: "TakenName" }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("DeleteCollection", () => {
    it.scoped("deletes a leaf collection", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "LeafDel", parentId: null });
        const result = yield* client.DeleteCollection({ collectionId: col.id });
        expect(result.deletedCount).toBe(1);
        const exit = yield* Effect.exit(client.GetCollection({ collectionId: col.id }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("returns CollectionHasChildrenError for non-recursive delete with children", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const parent = yield* client.CreateCollection({ name: "HasChildren", parentId: null });
        yield* client.CreateCollection({ name: "ChildOfHasChildren", parentId: parent.id });
        const exit = yield* Effect.exit(client.DeleteCollection({ collectionId: parent.id, recursive: false }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("deletes a collection tree recursively", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const root = yield* client.CreateCollection({ name: "RecursiveRoot", parentId: null });
        yield* client.CreateCollection({ name: "Child1", parentId: root.id });
        yield* client.CreateCollection({ name: "Child2", parentId: root.id });
        const result = yield* client.DeleteCollection({ collectionId: root.id, recursive: true });
        expect(result.deletedCount).toBe(3);
      }),
    );
  });

  describe("MoveCollection", () => {
    it.scoped("moves a collection to a new parent", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const dest = yield* client.CreateCollection({ name: "MoveDest", parentId: null });
        const mover = yield* client.CreateCollection({ name: "MoveMe", parentId: null });
        const result = yield* client.MoveCollection({ collectionId: mover.id, newParentId: dest.id });
        expect(result.parentId).toBe(dest.id);
      }),
    );

    it.scoped("returns CircularCollectionError when move would create a cycle", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const parent = yield* client.CreateCollection({ name: "CycleParent", parentId: null });
        const child = yield* client.CreateCollection({ name: "CycleChild", parentId: parent.id });
        const exit = yield* Effect.exit(client.MoveCollection({ collectionId: parent.id, newParentId: child.id }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("AddDocumentToCollection / RemoveDocumentFromCollection", () => {
    it.scoped("adds and removes a document from a collection", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "DocCol", parentId: null });

        const docId = "col-h-doc-1" as DocumentId;
        yield* DocumentSql.insertDocument({ id: docId, user_id: TEST_USER_ID, name: "ColDoc", format: "pdf", blob_key: "col-blob-1" });

        yield* client.AddDocumentToCollection({ collectionId: col.id, documentId: docId });
        yield* client.RemoveDocumentFromCollection({ collectionId: col.id, documentId: docId });
      }),
    );

    it.scoped("returns ConflictError when adding the same document twice", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "DupDocCol", parentId: null });

        const docId = "col-h-doc-2" as DocumentId;
        yield* DocumentSql.insertDocument({ id: docId, user_id: TEST_USER_ID, name: "DupColDoc", format: "jpg", blob_key: "col-blob-2" });

        yield* client.AddDocumentToCollection({ collectionId: col.id, documentId: docId });
        const exit = yield* Effect.exit(client.AddDocumentToCollection({ collectionId: col.id, documentId: docId }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("returns NotFoundError when removing a document not in the collection", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const col = yield* client.CreateCollection({ name: "EmptyCol", parentId: null });
        const exit = yield* Effect.exit(client.RemoveDocumentFromCollection({ collectionId: col.id, documentId: "ghost-doc" as DocumentId }));
        expect(exit._tag).toBe("Failure");
      }),
    );
  });
});
