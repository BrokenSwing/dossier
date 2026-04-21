import { describe, expect, it, layer } from "@effect/vitest"
import * as os from "node:os"
import * as path from "node:path"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Layer from "effect/Layer"
import { FileSystem } from "@effect/platform/FileSystem"
import { NodeContext } from "@effect/platform-node"
import { BlobStore, layer as blobStoreLayer } from "../../src/services/BlobStore.js"

const dir = path.join(os.tmpdir(), `dossier-blobstore-test-${Date.now()}`)

const BlobTestLayer = Layer.mergeAll(
  blobStoreLayer(dir),
  NodeContext.layer,
  Layer.scopedDiscard(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem
      yield* Effect.addFinalizer(() =>
        fileSystem.remove(dir, { recursive: true }).pipe(Effect.orElse(() => Effect.void)),
      )
    }),
  ),
).pipe(Layer.provide(NodeContext.layer))

layer(BlobTestLayer)("BlobStore", (it) => {
  describe("write", () => {
    it.effect("writes a blob without throwing", () =>
      Effect.gen(function* () {
        const store = yield* BlobStore
        yield* store.write("test-blob-write", new Uint8Array([1, 2, 3, 4, 5]))
      }),
    )

    it.effect("creates the blob directory automatically", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem
        expect(yield* fileSystem.exists(dir)).toBe(true)
      }),
    )
  })

  describe("readStream", () => {
    it.effect("reads back the same bytes that were written", () =>
      Effect.gen(function* () {
        const store = yield* BlobStore
        const data = new Uint8Array([10, 20, 30, 40, 50])
        const key = "test-blob-roundtrip"
        yield* store.write(key, data)

        const chunks = yield* Stream.runCollect(store.readStream(key)).pipe(
          Effect.map((chunk) => [...chunk]),
        )
        const received = Buffer.concat(chunks.map((c) => Buffer.from(c)))
        expect(Array.from(received)).toEqual(Array.from(data))
      }),
    )

    it.effect("fails with InternalError when the blob does not exist", () =>
      Effect.gen(function* () {
        const store = yield* BlobStore
        const exit = yield* Effect.exit(Stream.runDrain(store.readStream("nonexistent-blob")))
        expect(exit._tag).toBe("Failure")
      }),
    )
  })

  describe("delete", () => {
    it.effect("removes the blob file", () =>
      Effect.gen(function* () {
        const store = yield* BlobStore
        const fileSystem = yield* FileSystem
        const key = "test-blob-delete"
        yield* store.write(key, new Uint8Array([99]))
        const filePath = path.join(dir, key)
        expect(yield* fileSystem.exists(filePath)).toBe(true)

        yield* store.delete(key)
        expect(yield* fileSystem.exists(filePath)).toBe(false)
      }),
    )

    it.effect("does not throw when deleting a non-existent blob", () =>
      Effect.gen(function* () {
        const store = yield* BlobStore
        yield* store.delete("ghost-blob")
      }),
    )
  })
})
