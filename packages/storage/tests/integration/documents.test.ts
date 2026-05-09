import { describe, expect, layer } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { STORAGE_SESSION_HEADER, StorageIntegrationLayer, StorageRpcClient, TestPort, fullAuthFlow } from "./setup.js";

// One session is established for the whole describe block so document tests
// don't pay the argon2 cost on every test.
class TestSessionToken extends Context.Tag("dossier/integration/TestSessionToken")<TestSessionToken, string>() {}

const SessionLayer = Layer.scoped(TestSessionToken, fullAuthFlow("doc_test_user").pipe(Effect.orDie));

const DocumentsTestLayer = Layer.mergeAll(StorageIntegrationLayer, SessionLayer.pipe(Layer.provide(StorageIntegrationLayer)));

layer(DocumentsTestLayer)("Storage HTTP integration — documents", (it) => {
  describe("CreateDocumentMeta + GetDocumentMeta", () => {
    it.scoped("creates a document and retrieves its metadata", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        const { documentId } = yield* client.CreateDocumentMeta({ name: "My PDF", format: "pdf", tagNames: ["tag-a"], collectionIds: [] }, auth);
        const meta = yield* client.GetDocumentMeta({ documentId }, auth);

        expect(meta.name).toBe("My PDF");
        expect(meta.format).toBe("pdf");
        expect(meta.tags).toContain("tag-a");
      }),
    );

    it.scoped("returns an error for an unknown document id", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const exit = yield* Effect.exit(
          client.GetDocumentMeta({ documentId: "no-such-id" as any }, { headers: { [STORAGE_SESSION_HEADER]: token } }),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("RenameDocument", () => {
    it.scoped("updates the document name", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        const { documentId } = yield* client.CreateDocumentMeta({ name: "OldName", format: "jpg", tagNames: [], collectionIds: [] }, auth);
        yield* client.RenameDocument({ documentId, name: "NewName" }, auth);
        const meta = yield* client.GetDocumentMeta({ documentId }, auth);

        expect(meta.name).toBe("NewName");
      }),
    );
  });

  describe("UpdateDocumentTags", () => {
    it.scoped("replaces the tag set on a document", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        const { documentId } = yield* client.CreateDocumentMeta({ name: "TagDoc", format: "png", tagNames: ["old"], collectionIds: [] }, auth);
        const tags = yield* client.UpdateDocumentTags({ documentId, tagNames: ["new-a", "new-b"] }, auth);

        expect(tags.map((t) => t.name)).toEqual(expect.arrayContaining(["new-a", "new-b"]));
        expect(tags).toHaveLength(2);
      }),
    );
  });

  describe("DeleteDocument", () => {
    it.scoped("deletes a document so it can no longer be retrieved", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        const { documentId } = yield* client.CreateDocumentMeta({ name: "ToDelete", format: "pdf", tagNames: [], collectionIds: [] }, auth);
        yield* client.DeleteDocument({ documentId }, auth);
        const exit = yield* Effect.exit(client.GetDocumentMeta({ documentId }, auth));

        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("ListDocuments", () => {
    it.scoped("returns documents belonging to the authenticated user", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        yield* client.CreateDocumentMeta({ name: "ListDoc-A", format: "pdf", tagNames: [], collectionIds: [] }, auth);
        yield* client.CreateDocumentMeta({ name: "ListDoc-B", format: "jpg", tagNames: [], collectionIds: [] }, auth);

        const page = yield* client.ListDocuments({ sortField: "name", sortDirection: "asc", limit: 50 }, auth);
        const names = page.documents.map((d) => d.name);

        expect(names).toContain("ListDoc-A");
        expect(names).toContain("ListDoc-B");
      }),
    );
  });

  describe("Blob upload pipeline", () => {
    it.scoped("upload via PUT /blobs/:key → ConfirmBlobUpload → DownloadDocumentBlob", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const port = yield* TestPort;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };
        const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);

        const { documentId, blobKey } = yield* client.CreateDocumentMeta({ name: "BlobDoc", format: "pdf", tagNames: [], collectionIds: [] }, auth);

        const uploadRes = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/blobs/${blobKey}`, {
            method: "PUT",
            headers: { [STORAGE_SESSION_HEADER]: token },
            body: payload,
          }),
        );
        expect(uploadRes.status).toBe(204);

        yield* client.ConfirmBlobUpload({ documentId, encryptedSize: payload.length }, auth);

        const chunks = yield* Stream.runCollect(client.DownloadDocumentBlob({ documentId }, auth)).pipe(
          Effect.map((c) => new Uint8Array(Chunk.toArray(c).flatMap((b) => Array.from(b)))),
        );
        expect(chunks).toEqual(payload);
      }),
    );

    it.scoped("PUT /blobs/:key returns 401 without a session token", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const token = yield* TestSessionToken;
        const port = yield* TestPort;
        const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

        const { blobKey } = yield* client.CreateDocumentMeta({ name: "UnauthorizedBlob", format: "pdf", tagNames: [], collectionIds: [] }, auth);
        const res = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/blobs/${blobKey}`, { method: "PUT", body: new Uint8Array([1, 2, 3]) }),
        );
        expect(res.status).toBe(401);
      }),
    );

    it.scoped("PUT /blobs/:key returns 404 for a blobKey not owned by the session user", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* TestPort;
        const res = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/blobs/non-existent-blob-key`, {
            method: "PUT",
            headers: { [STORAGE_SESSION_HEADER]: token },
            body: new Uint8Array([1, 2, 3]),
          }),
        );
        expect(res.status).toBe(404);
      }),
    );
  });

  describe("Cross-user isolation", () => {
    it.scoped("user A cannot read user B's documents", () =>
      Effect.gen(function* () {
        const client = yield* StorageRpcClient;
        const tokenA = yield* TestSessionToken;
        const tokenB = yield* fullAuthFlow("isolation_user_b");
        const authB = { headers: { [STORAGE_SESSION_HEADER]: tokenB } };

        const { documentId } = yield* client.CreateDocumentMeta({ name: "Private", format: "pdf", tagNames: [], collectionIds: [] }, authB);
        const exit = yield* Effect.exit(client.GetDocumentMeta({ documentId }, { headers: { [STORAGE_SESSION_HEADER]: tokenA } }));

        expect(exit._tag).toBe("Failure");
      }),
    );
  });
});
