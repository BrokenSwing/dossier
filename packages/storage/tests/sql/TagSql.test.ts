import { describe, expect, it, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { DocumentId, TagId, UserId } from "@dossier/shared"
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js"
import * as UserSql from "../../src/sql/UserSql.js"
import * as DocumentSql from "../../src/sql/DocumentSql.js"
import * as TagSql from "../../src/sql/TagSql.js"

const uid = TEST_USER_ID

let docCounter = 0
const makeDoc = (name: string) => ({
  id: `tag-test-doc-${++docCounter}` as DocumentId,
  user_id: uid as string,
  name,
  format: "jpg" as const,
  blob_key: `tag-blob-${docCounter}`,
})

const TagTestLayer = Layer.merge(
  TestSqlLayer,
  Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(Layer.provide(TestSqlLayer)),
)

layer(TagTestLayer)("TagSql", (it) => {
  describe("listTagsWithCount", () => {
    it.effect("returns an empty list when user has no tags", () =>
      Effect.gen(function* () {
        const tags = yield* TagSql.listTagsWithCount("no-tags-user" as UserId)
        expect(tags).toHaveLength(0)
      }),
    )

    it.effect("returns tags with correct document counts", () =>
      Effect.gen(function* () {
        const doc1 = makeDoc("TagDoc1")
        const doc2 = makeDoc("TagDoc2")
        yield* DocumentSql.insertDocument(doc1)
        yield* DocumentSql.insertDocument(doc2)
        yield* DocumentSql.updateDocumentTags(doc1.id, uid, ["alpha", "shared"])
        yield* DocumentSql.updateDocumentTags(doc2.id, uid, ["beta", "shared"])

        const tags = yield* TagSql.listTagsWithCount(uid)
        const byName = Object.fromEntries(tags.map((t) => [t.name, t.documentCount]))
        expect(byName["alpha"]).toBe(1)
        expect(byName["beta"]).toBe(1)
        expect(byName["shared"]).toBe(2)
      }),
    )

    it.effect("returns tags sorted by name case-insensitively", () =>
      Effect.gen(function* () {
        const doc = makeDoc("SortTagDoc")
        yield* DocumentSql.insertDocument(doc)
        yield* DocumentSql.updateDocumentTags(doc.id, uid, ["Zebra", "apple", "Mango"])

        const tags = yield* TagSql.listTagsWithCount(uid)
        const userTags = tags.map((t) => t.name)
        const zebraIdx = userTags.findIndex((n) => n.toLowerCase() === "zebra")
        const appleIdx = userTags.findIndex((n) => n.toLowerCase() === "apple")
        const mangoIdx = userTags.findIndex((n) => n.toLowerCase() === "mango")
        expect(appleIdx).toBeLessThan(mangoIdx)
        expect(mangoIdx).toBeLessThan(zebraIdx)
      }),
    )
  })

  describe("deleteTag", () => {
    it.effect("deletes an existing tag and returns 1", () =>
      Effect.gen(function* () {
        const doc = makeDoc("DeleteTagDoc")
        yield* DocumentSql.insertDocument(doc)
        yield* DocumentSql.updateDocumentTags(doc.id, uid, ["to-delete"])

        const tags = yield* TagSql.listTagsWithCount(uid)
        const tag = tags.find((t) => t.name === "to-delete")
        expect(tag).toBeDefined()

        const count = yield* TagSql.deleteTag(tag!.id as TagId, uid)
        expect(count).toBe(1)
      }),
    )

    it.effect("returns 0 for a non-existent tag", () =>
      Effect.gen(function* () {
        const count = yield* TagSql.deleteTag("no-such-tag" as TagId, uid)
        expect(count).toBe(0)
      }),
    )

    it.effect("does not delete a tag belonging to another user", () =>
      Effect.gen(function* () {
        const doc = makeDoc("OtherUserTagDoc")
        yield* DocumentSql.insertDocument(doc)
        yield* DocumentSql.updateDocumentTags(doc.id, uid, ["other-user-tag"])

        const tags = yield* TagSql.listTagsWithCount(uid)
        const tag = tags.find((t) => t.name === "other-user-tag")
        expect(tag).toBeDefined()

        const count = yield* TagSql.deleteTag(tag!.id as TagId, "stranger" as UserId)
        expect(count).toBe(0)
      }),
    )
  })
})
