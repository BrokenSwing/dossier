import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Chunk from "effect/Chunk";
import * as Layer from "effect/Layer";
import * as RpcTest from "@effect/rpc/RpcTest";
import {
  StorageAuth,
  StorageDocumentRpcs,
  DocumentId,
  CollectionId,
} from "@dossier/shared";
import { documentHandlers } from "../../src/handlers/DocumentHandlers.js";
import { BlobStore } from "../../src/services/BlobStore.js";
import * as UserSql from "../../src/sql/UserSql.js";
import * as CollectionSql from "../../src/sql/CollectionSql.js";
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js";
import { FakeStorageAuthLayer, FakeBlobStoreLayer } from "./setup.js";

const group = StorageDocumentRpcs.middleware(StorageAuth);

const BaseLayer = Layer.mergeAll(
  FakeStorageAuthLayer,
  FakeBlobStoreLayer,
  TestSqlLayer,
);

const DocumentTestLayer = Layer.mergeAll(
  documentHandlers.pipe(Layer.provide(BaseLayer)),
  BaseLayer,
  Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(
    Layer.provide(TestSqlLayer),
  ),
);

layer(DocumentTestLayer)("DocumentHandlers", (it) => {
  describe("CreateDocumentMeta + GetDocumentMeta", () => {
    it.scoped("creates a document and retrieves its metadata", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const { documentId } = yield* client.CreateDocumentMeta({
          name: "Test Doc",
          format: "pdf",
          tagNames: ["tag-a", "tag-b"],
          collectionIds: [],
        });
        const meta = yield* client.GetDocumentMeta({ documentId });
        expect(meta.name).toBe("Test Doc");
        expect(meta.format).toBe("pdf");
        expect(meta.tags).toEqual(expect.arrayContaining(["tag-a", "tag-b"]));
        expect(meta.tags).toHaveLength(2);
      }),
    );

    it.scoped("returns NotFoundError for unknown document", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const exit = yield* Effect.exit(
          client.GetDocumentMeta({ documentId: "no-such-doc" as DocumentId }),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("RenameDocument", () => {
    it.scoped("renames an existing document", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const { documentId } = yield* client.CreateDocumentMeta({
          name: "OldName",
          format: "jpg",
          tagNames: [],
          collectionIds: [],
        });
        yield* client.RenameDocument({ documentId, name: "NewName" });
        const meta = yield* client.GetDocumentMeta({ documentId });
        expect(meta.name).toBe("NewName");
      }),
    );
  });

  describe("UpdateDocumentTags", () => {
    it.scoped("replaces tags on a document", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const { documentId } = yield* client.CreateDocumentMeta({
          name: "TagDoc",
          format: "png",
          tagNames: ["old-tag"],
          collectionIds: [],
        });
        const tags = yield* client.UpdateDocumentTags({
          documentId,
          tagNames: ["new-a", "new-b"],
        });
        expect(tags.map((t) => t.name)).toEqual(
          expect.arrayContaining(["new-a", "new-b"]),
        );
        expect(tags).toHaveLength(2);
      }),
    );
  });

  describe("UpdateDocumentCollections", () => {
    it.scoped("assigns a document to collections", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);

        const col = yield* CollectionSql.insertCollection({
          id: "doc-h-col-1",
          user_id: TEST_USER_ID,
          name: "DocHCol",
          parent_id: null,
          watermark_text: null,
        });

        const { documentId } = yield* client.CreateDocumentMeta({
          name: "ColAssignDoc",
          format: "pdf",
          tagNames: [],
          collectionIds: [],
        });

        yield* client.UpdateDocumentCollections({
          documentId,
          collectionIds: [col.id as CollectionId],
        });

        const meta = yield* client.GetDocumentMeta({ documentId });
        expect(meta.collectionIds).toContain(col.id);
      }),
    );
  });

  describe("DeleteDocument", () => {
    it.scoped("deletes an existing document", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const { documentId } = yield* client.CreateDocumentMeta({
          name: "ToDelete",
          format: "pdf",
          tagNames: [],
          collectionIds: [],
        });
        yield* client.DeleteDocument({ documentId });
        const exit = yield* Effect.exit(client.GetDocumentMeta({ documentId }));
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("returns NotFoundError for unknown document", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);
        const exit = yield* Effect.exit(
          client.DeleteDocument({ documentId: "ghost" as DocumentId }),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("DownloadDocumentBlob", () => {
    it.scoped("streams the blob bytes back", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);

        const { documentId, blobKey } = yield* client.CreateDocumentMeta({
          name: "BlobDoc",
          format: "pdf",
          tagNames: [],
          collectionIds: [],
        });

        const blobStore = yield* BlobStore;
        const payload = new Uint8Array([1, 2, 3, 4]);
        yield* blobStore.write(blobKey, payload);

        const chunks = yield* Stream.runCollect(
          client.DownloadDocumentBlob({ documentId }),
        );
        const merged = new Uint8Array(
          Chunk.toArray(chunks).flatMap((c) => Array.from(c)),
        );
        expect(merged).toEqual(payload);
      }),
    );
  });

  describe("ListDocuments", () => {
    it.scoped("lists documents for the authenticated user", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group);

        yield* client.CreateDocumentMeta({
          name: "ListA",
          format: "pdf",
          tagNames: [],
          collectionIds: [],
        });
        yield* client.CreateDocumentMeta({
          name: "ListB",
          format: "jpg",
          tagNames: [],
          collectionIds: [],
        });

        const page = yield* client.ListDocuments({
          sortField: "name",
          sortDirection: "asc",
          limit: 50,
        });
        const names = page.documents.map((d) => d.name);
        expect(names).toContain("ListA");
        expect(names).toContain("ListB");
      }),
    );
  });
});
