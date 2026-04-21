import { describe, expect, it, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcTest from "@effect/rpc/RpcTest"
import {
  StorageAuth,
  StorageTagRpcs,
  TagId,
  DocumentId,
} from "@dossier/shared"
import { tagHandlers } from "../../src/handlers/TagHandlers.js"
import * as UserSql from "../../src/sql/UserSql.js"
import * as DocumentSql from "../../src/sql/DocumentSql.js"
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js"
import { FakeStorageAuthLayer } from "./setup.js"

const group = StorageTagRpcs.middleware(StorageAuth)

const BaseLayer = Layer.mergeAll(FakeStorageAuthLayer, TestSqlLayer)

const TagTestLayer = Layer.mergeAll(
  tagHandlers.pipe(Layer.provide(BaseLayer)),
  BaseLayer,
  Layer.effectDiscard(UserSql.insertUser(TEST_USER)).pipe(Layer.provide(TestSqlLayer)),
)

layer(TagTestLayer)("TagHandlers", (it) => {
  describe("ListTags", () => {
    it.scoped("returns empty array when user has no tags", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group)
        const tags = yield* client.ListTags()
        expect(tags).toHaveLength(0)
      }),
    )

    it.scoped("returns tags with correct document counts", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group)

        const doc1Id = "tag-h-doc-1" as DocumentId
        const doc2Id = "tag-h-doc-2" as DocumentId
        yield* DocumentSql.insertDocument({ id: doc1Id, user_id: TEST_USER_ID, name: "Doc1", format: "pdf", blob_key: "key1" })
        yield* DocumentSql.insertDocument({ id: doc2Id, user_id: TEST_USER_ID, name: "Doc2", format: "jpg", blob_key: "key2" })
        yield* DocumentSql.updateDocumentTags(doc1Id, TEST_USER_ID, ["alpha", "shared"])
        yield* DocumentSql.updateDocumentTags(doc2Id, TEST_USER_ID, ["beta", "shared"])

        const tags = yield* client.ListTags()
        const byName = Object.fromEntries(tags.map((t) => [t.name, t.documentCount]))
        expect(byName["alpha"]).toBe(1)
        expect(byName["beta"]).toBe(1)
        expect(byName["shared"]).toBe(2)
      }),
    )
  })

  describe("DeleteTag", () => {
    it.scoped("deletes an existing tag successfully", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group)

        const docId = "tag-h-del-doc" as DocumentId
        yield* DocumentSql.insertDocument({ id: docId, user_id: TEST_USER_ID, name: "DelTagDoc", format: "pdf", blob_key: "del-key" })
        yield* DocumentSql.updateDocumentTags(docId, TEST_USER_ID, ["to-delete-handler"])

        const tags = yield* client.ListTags()
        const tag = tags.find((t) => t.name === "to-delete-handler")
        expect(tag).toBeDefined()

        yield* client.DeleteTag({ tagId: tag!.id as TagId })

        const after = yield* client.ListTags()
        expect(after.find((t) => t.name === "to-delete-handler")).toBeUndefined()
      }),
    )

    it.scoped("returns NotFoundError for non-existent tag", () =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(group)
        const exit = yield* Effect.exit(client.DeleteTag({ tagId: "no-such-tag" as TagId }))
        expect(exit._tag).toBe("Failure")
      }),
    )
  })
})
