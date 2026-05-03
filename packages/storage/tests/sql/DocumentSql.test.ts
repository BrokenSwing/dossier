import { DocumentId, ListDocumentsParams, UserId } from "@dossier/shared";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DocumentSql from "../../src/sql/DocumentSql.js";
import * as UserSql from "../../src/sql/UserSql.js";
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js";

const uid = TEST_USER_ID;

const defaultParams = (overrides: Partial<ConstructorParameters<typeof ListDocumentsParams>[0]> = {}) =>
  new ListDocumentsParams({
    sortField: "name",
    sortDirection: "asc",
    nameFilter: undefined,
    tagFilter: undefined,
    collectionFilter: undefined,
    cursor: undefined,
    limit: 20,
    ...overrides,
  });

let docCounter = 0;
const makeDoc = (name: string) => ({
  id: `doc-${++docCounter}-${Date.now()}` as DocumentId,
  user_id: uid as string,
  name,
  format: "pdf" as const,
  blob_key: `blob-${docCounter}`,
});

const DocumentTestLayer = Layer.merge(TestSqlLayer, Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(Layer.provide(TestSqlLayer)));

layer(DocumentTestLayer)("DocumentSql", (it) => {
  describe("insertDocument + findById", () => {
    it.effect("inserts and retrieves a document by id", () =>
      Effect.gen(function* () {
        const doc = makeDoc("My PDF");
        yield* DocumentSql.insertDocument(doc);
        const result = yield* DocumentSql.findById(doc.id, uid);
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value.name).toBe("My PDF");
          expect(result.value.encryptedSize).toBe(0);
        }
      }),
    );

    it.effect("returns None for a non-existent document", () =>
      Effect.gen(function* () {
        const result = yield* DocumentSql.findById("no-such-doc" as DocumentId, uid);
        expect(Option.isNone(result)).toBe(true);
      }),
    );

    it.effect("does not return documents belonging to another user", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Private");
        yield* DocumentSql.insertDocument(doc);
        const result = yield* DocumentSql.findById(doc.id, "stranger" as UserId);
        expect(Option.isNone(result)).toBe(true);
      }),
    );
  });

  describe("findByBlobKey", () => {
    it.effect("finds a document by its blob key", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Blob Doc");
        yield* DocumentSql.insertDocument(doc);
        const result = yield* DocumentSql.findByBlobKey(doc.blob_key, uid);
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value.id).toBe(doc.id);
        }
      }),
    );

    it.effect("returns None for an unknown blob key", () =>
      Effect.gen(function* () {
        const result = yield* DocumentSql.findByBlobKey("no-blob-key", uid);
        expect(Option.isNone(result)).toBe(true);
      }),
    );
  });

  describe("confirmBlobUpload", () => {
    it.effect("updates encrypted_size from 0", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Upload Target");
        yield* DocumentSql.insertDocument(doc);
        yield* DocumentSql.confirmBlobUpload(doc.id, uid, 1024);
        const meta = yield* DocumentSql.findById(doc.id, uid);
        expect(Option.isSome(meta)).toBe(true);
        if (Option.isSome(meta)) {
          expect(meta.value.encryptedSize).toBe(1024);
        }
      }),
    );
  });

  describe("renameDocument", () => {
    it.effect("changes the document name", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Old Name");
        yield* DocumentSql.insertDocument(doc);
        yield* DocumentSql.renameDocument(doc.id, uid, "New Name");
        const meta = yield* DocumentSql.findById(doc.id, uid);
        expect(Option.isSome(meta)).toBe(true);
        if (Option.isSome(meta)) expect(meta.value.name).toBe("New Name");
      }),
    );
  });

  describe("deleteDocument", () => {
    it.effect("removes the document and returns its blob key", () =>
      Effect.gen(function* () {
        const doc = makeDoc("To Delete");
        yield* DocumentSql.insertDocument(doc);
        const blobKey = yield* DocumentSql.deleteDocument(doc.id, uid);
        expect(blobKey).toBe(doc.blob_key);
        const found = yield* DocumentSql.findById(doc.id, uid);
        expect(Option.isNone(found)).toBe(true);
      }),
    );
  });

  describe("updateDocumentTags", () => {
    it.effect("assigns tags to a document", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Tagged Doc");
        yield* DocumentSql.insertDocument(doc);
        const tags = yield* DocumentSql.updateDocumentTags(doc.id, uid, ["invoices", "2024"]);
        expect(tags.sort()).toEqual(["2024", "invoices"]);
      }),
    );

    it.effect("replaces existing tags", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Re-Tagged");
        yield* DocumentSql.insertDocument(doc);
        yield* DocumentSql.updateDocumentTags(doc.id, uid, ["old-tag"]);
        const tags = yield* DocumentSql.updateDocumentTags(doc.id, uid, ["new-tag"]);
        expect(tags).toEqual(["new-tag"]);
      }),
    );

    it.effect("clears all tags when given an empty array", () =>
      Effect.gen(function* () {
        const doc = makeDoc("Clear Tags");
        yield* DocumentSql.insertDocument(doc);
        yield* DocumentSql.updateDocumentTags(doc.id, uid, ["removeme"]);
        const tags = yield* DocumentSql.updateDocumentTags(doc.id, uid, []);
        expect(tags).toEqual([]);
      }),
    );
  });

  describe("listDocuments (cursor pagination)", () => {
    it.effect("returns an empty page when no documents exist for user", () =>
      Effect.gen(function* () {
        const page = yield* DocumentSql.listDocuments("empty-user" as UserId, defaultParams());
        expect(page.documents).toHaveLength(0);
        expect(page.nextCursor).toBeNull();
      }),
    );

    it.effect("returns documents sorted by name ascending", () =>
      Effect.gen(function* () {
        const pagUid = `pag-user-${Date.now()}` as UserId;
        yield* UserSql.insertUser({ ...TEST_USER, id: pagUid, username: `paguser_${Date.now()}` });
        yield* DocumentSql.insertDocument({ ...makeDoc("Alpha"), user_id: pagUid });
        yield* DocumentSql.insertDocument({ ...makeDoc("Beta"), user_id: pagUid });
        yield* DocumentSql.insertDocument({ ...makeDoc("Gamma"), user_id: pagUid });

        const page = yield* DocumentSql.listDocuments(pagUid, defaultParams({ limit: 10 }));
        expect(page.documents.map((d) => d.name)).toEqual(["Alpha", "Beta", "Gamma"]);
        expect(page.nextCursor).toBeNull();
      }),
    );

    it.effect("paginates with a cursor", () =>
      Effect.gen(function* () {
        const pagUid = `pag-cur-${Date.now()}` as UserId;
        yield* UserSql.insertUser({ ...TEST_USER, id: pagUid, username: `pagcur_${Date.now()}` });
        for (const name of ["Doc1", "Doc2", "Doc3"]) {
          yield* DocumentSql.insertDocument({ ...makeDoc(name), user_id: pagUid });
        }

        const page1 = yield* DocumentSql.listDocuments(pagUid, defaultParams({ limit: 2 }));
        expect(page1.documents).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = yield* DocumentSql.listDocuments(pagUid, defaultParams({ limit: 2, cursor: page1.nextCursor ?? undefined }));
        expect(page2.documents).toHaveLength(1);
        expect(page2.nextCursor).toBeNull();
        const all = [...page1.documents, ...page2.documents].map((d) => d.name).sort();
        expect(all).toEqual(["Doc1", "Doc2", "Doc3"]);
      }),
    );

    it.effect("filters by name", () =>
      Effect.gen(function* () {
        const pagUid = `pag-name-${Date.now()}` as UserId;
        yield* UserSql.insertUser({ ...TEST_USER, id: pagUid, username: `pagname_${Date.now()}` });
        yield* DocumentSql.insertDocument({ ...makeDoc("invoice-2024"), user_id: pagUid });
        yield* DocumentSql.insertDocument({ ...makeDoc("contract-2024"), user_id: pagUid });

        const page = yield* DocumentSql.listDocuments(pagUid, defaultParams({ nameFilter: "invoice" }));
        expect(page.documents).toHaveLength(1);
        expect(page.documents[0]?.name).toBe("invoice-2024");
      }),
    );
  });
});
