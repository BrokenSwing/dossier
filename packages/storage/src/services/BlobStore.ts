import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { InternalError } from "@dossier/shared"

export class BlobStore extends Context.Tag("@dossier/storage/BlobStore")<
  BlobStore,
  {
    write(key: string, data: Uint8Array): Effect.Effect<void, InternalError>
    readStream(key: string): Stream.Stream<Uint8Array, InternalError>
    delete(key: string): Effect.Effect<void, InternalError>
  }
>() {}

export const layer = (dir: string): Layer.Layer<BlobStore, never, FileSystem | Path> =>
  Layer.effect(
    BlobStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const pathSvc = yield* Path

      yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.catchAll(() => Effect.void)
      )

      return BlobStore.of({
        write: (key, data) =>
          fs.writeFile(pathSvc.join(dir, key), data).pipe(
            Effect.mapError(
              (e) => new InternalError({ message: `Failed to write blob ${key}: ${e.message}` })
            )
          ),

        readStream: (key) =>
          fs.stream(pathSvc.join(dir, key)).pipe(
            Stream.mapError(
              (e) => new InternalError({ message: `Failed to read blob ${key}: ${e.message}` })
            )
          ),

        delete: (key) =>
          fs.remove(pathSvc.join(dir, key)).pipe(
            Effect.catchAll(() => Effect.void)
          ),
      })
    })
  )
