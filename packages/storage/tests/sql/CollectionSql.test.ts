import { CollectionId, UserId, WatermarkConfig } from "@dossier/shared";
import { describe, expect, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CollectionSql from "../../src/sql/CollectionSql.js";
import * as UserSql from "../../src/sql/UserSql.js";
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js";

const uid = TEST_USER_ID;

const CollectionTestLayer = Layer.merge(TestSqlLayer, Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(Layer.provide(TestSqlLayer)));

const insertRoot = (name: string) =>
  CollectionSql.insertCollection({
    id: `col-${name.toLowerCase().replace(/\s+/g, "-")}`,
    user_id: uid,
    name,
    parent_id: null,
    watermark_text: null,
  });

layer(CollectionTestLayer)("CollectionSql", (it) => {
  describe("listCollections", () => {
    it.effect("returns an empty list when the user has no collections", () =>
      Effect.gen(function* () {
        const result = yield* CollectionSql.listCollections("other-user" as UserId);
        expect(result).toEqual([]);
      }),
    );

    it.effect("returns inserted collections sorted by name", () =>
      Effect.gen(function* () {
        yield* insertRoot("Zebra");
        yield* insertRoot("Alpha");
        const result = yield* CollectionSql.listCollections(uid);
        const names = result.map((c) => c.name);
        expect(names).toContain("Alpha");
        expect(names).toContain("Zebra");
        expect(names.indexOf("Alpha")).toBeLessThan(names.indexOf("Zebra"));
      }),
    );
  });

  describe("findById", () => {
    it.effect("returns None for a non-existent collection", () =>
      Effect.gen(function* () {
        const result = yield* CollectionSql.findById("no-such" as CollectionId, uid);
        expect(Option.isNone(result)).toBe(true);
      }),
    );

    it.effect("returns Some with correct data for an existing collection", () =>
      Effect.gen(function* () {
        const inserted = yield* insertRoot("FindMe");
        const result = yield* CollectionSql.findById(inserted.id, uid);
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value.name).toBe("FindMe");
          expect(result.value.parentId).toBeNull();
        }
      }),
    );

    it.effect("does not return collections belonging to another user", () =>
      Effect.gen(function* () {
        const inserted = yield* insertRoot("OtherOwned");
        const result = yield* CollectionSql.findById(inserted.id, "stranger" as UserId);
        expect(Option.isNone(result)).toBe(true);
      }),
    );
  });

  describe("checkRootNameConflict", () => {
    it.effect("returns false when name is unique at root", () =>
      Effect.gen(function* () {
        const conflict = yield* CollectionSql.checkRootNameConflict(uid, "UniqueNameXXX");
        expect(conflict).toBe(false);
      }),
    );

    it.effect("returns true when a root collection with that name exists", () =>
      Effect.gen(function* () {
        yield* insertRoot("DuplicateRoot");
        const conflict = yield* CollectionSql.checkRootNameConflict(uid, "DuplicateRoot");
        expect(conflict).toBe(true);
      }),
    );

    it.effect("excludes the specified id from conflict check", () =>
      Effect.gen(function* () {
        const col = yield* insertRoot("ExcludeMe");
        const conflict = yield* CollectionSql.checkRootNameConflict(uid, "ExcludeMe", col.id);
        expect(conflict).toBe(false);
      }),
    );

    it.effect("is case-insensitive", () =>
      Effect.gen(function* () {
        yield* insertRoot("CaseCheck");
        const conflict = yield* CollectionSql.checkRootNameConflict(uid, "casecheck");
        expect(conflict).toBe(true);
      }),
    );
  });

  describe("checkCircular", () => {
    it.effect("returns false when move is not circular", () =>
      Effect.gen(function* () {
        const parent = yield* insertRoot("CircParent");
        const child = yield* CollectionSql.insertCollection({
          id: "circ-child",
          user_id: uid,
          name: "CircChild",
          parent_id: parent.id,
          watermark_text: null,
        });
        const isCircular = yield* CollectionSql.checkCircular(child.id, parent.id, uid);
        expect(isCircular).toBe(false);
      }),
    );

    it.effect("detects direct circular reference (moving parent under its own child)", () =>
      Effect.gen(function* () {
        const parent = yield* insertRoot("CircPar2");
        const child = yield* CollectionSql.insertCollection({
          id: "circ-child-2",
          user_id: uid,
          name: "CircChild2",
          parent_id: parent.id,
          watermark_text: null,
        });
        const isCircular = yield* CollectionSql.checkCircular(parent.id, child.id, uid);
        expect(isCircular).toBe(true);
      }),
    );

    it.effect("detects deep circular references", () =>
      Effect.gen(function* () {
        const a = yield* insertRoot("DeepA");
        const b = yield* CollectionSql.insertCollection({
          id: "deep-b",
          user_id: uid,
          name: "DeepB",
          parent_id: a.id,
          watermark_text: null,
        });
        const c = yield* CollectionSql.insertCollection({
          id: "deep-c",
          user_id: uid,
          name: "DeepC",
          parent_id: b.id,
          watermark_text: null,
        });
        const isCircular = yield* CollectionSql.checkCircular(a.id, c.id, uid);
        expect(isCircular).toBe(true);
      }),
    );
  });

  describe("updateCollection", () => {
    it.effect("renames a collection", () =>
      Effect.gen(function* () {
        const col = yield* insertRoot("BeforeRename");
        const updated = yield* CollectionSql.updateCollection(col.id, uid, { name: "AfterRename" });
        expect(updated.name).toBe("AfterRename");
      }),
    );

    it.effect("sets a watermark", () =>
      Effect.gen(function* () {
        const col = yield* insertRoot("WatermarkTarget");
        const updated = yield* CollectionSql.updateCollection(col.id, uid, {
          watermark: new WatermarkConfig({ text: "CONFIDENTIAL" }),
        });
        expect((updated.watermark as { text: string } | null)?.text).toBe("CONFIDENTIAL");
      }),
    );
  });

  describe("deleteCollectionRecursive", () => {
    it.effect("deletes a single collection and returns count 1", () =>
      Effect.gen(function* () {
        const col = yield* insertRoot("ToDelete");
        const count = yield* CollectionSql.deleteCollectionRecursive(col.id, uid);
        expect(count).toBe(1);
        const found = yield* CollectionSql.findById(col.id, uid);
        expect(Option.isNone(found)).toBe(true);
      }),
    );

    it.effect("recursively deletes children and returns total count", () =>
      Effect.gen(function* () {
        const root = yield* insertRoot("RecRoot");
        yield* Effect.all([
          CollectionSql.insertCollection({
            id: "rec-child-1",
            user_id: uid,
            name: "RecChild1",
            parent_id: root.id,
            watermark_text: null,
          }),
          CollectionSql.insertCollection({
            id: "rec-child-2",
            user_id: uid,
            name: "RecChild2",
            parent_id: root.id,
            watermark_text: null,
          }),
        ]);
        const count = yield* CollectionSql.deleteCollectionRecursive(root.id, uid);
        expect(count).toBe(3);
      }),
    );
  });
});
