import { AtomRpc } from "@effect-atom/atom"
import {
  FetchHttpClient,
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpClient,
} from "@effect/platform"
import { RpcClient, RpcSerialization } from "@effect/rpc"
import { COMPUTE_SESSION_HEADER, ComputeRpcs, STORAGE_SESSION_HEADER, StorageRpcs } from "@dossier/shared"
import type { CollectionId, DocumentId } from "@dossier/shared"
import * as Effect from "effect/Effect"
import { Layer } from "effect"
import * as Schema from "effect/Schema"

// --- Protocol layers ---

const makeHttpProtocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  )

// --- RPC client tags ---

export class StorageRpc extends AtomRpc.Tag<StorageRpc>()("@dossier/client/StorageRpc", {
  group: StorageRpcs,
  protocol: makeHttpProtocol(`${import.meta.env.VITE_STORAGE_URL}/rpc`),
}) {}

export class ComputeRpc extends AtomRpc.Tag<ComputeRpc>()("@dossier/client/ComputeRpc", {
  group: ComputeRpcs,
  protocol: makeHttpProtocol(`${import.meta.env.VITE_COMPUTE_URL}/rpc`),
}) {}

// --- Session header helpers ---

export const storageHeaders = (sessionToken: string) =>
  ({ [STORAGE_SESSION_HEADER]: sessionToken }) as const

export const computeHeaders = (sessionToken: string) =>
  ({ [COMPUTE_SESSION_HEADER]: sessionToken }) as const

// --- Storage blob upload API (PUT /blobs/:blobKey) ---
// Used in local compute mode: client encrypts client-side, then pushes
// the encrypted bytes directly to storage.

const StorageBlobApi = HttpApi.make("StorageBlobApi").add(
  HttpApiGroup.make("blobs").add(
    HttpApiEndpoint.put("uploadBlob")`/blobs/${HttpApiSchema.param("blobKey", Schema.String)}`
      .setPayload(HttpApiSchema.Uint8Array())
      .setHeaders(Schema.Struct({ [STORAGE_SESSION_HEADER]: Schema.String }))
      .addSuccess(HttpApiSchema.Empty(204)),
  ),
)

export class UploadError extends Schema.TaggedError<UploadError>()("UploadError", {
  message: Schema.String,
}) {}

export const uploadBlob = (
  blobKey: string,
  encryptedData: Uint8Array,
  sessionToken: string,
): Effect.Effect<void, UploadError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(StorageBlobApi, {
      baseUrl: import.meta.env.VITE_STORAGE_URL ?? "",
    })
    yield* client.blobs.uploadBlob({
      path: { blobKey },
      payload: encryptedData,
      headers: { [STORAGE_SESSION_HEADER]: sessionToken },
    })
  }).pipe(Effect.mapError((e) => new UploadError({ message: String(e) })))

// --- Compute upload API (POST /upload) ---
// Used in server-hosted compute mode: compute receives the plaintext file,
// encrypts it with the DEK, uploads to storage, and confirms.

const ComputeUploadApi = HttpApi.make("ComputeUploadApi").add(
  HttpApiGroup.make("upload").add(
    HttpApiEndpoint.post("uploadDocument")`/upload`
      .setPayload(HttpApiSchema.Uint8Array())
      .setHeaders(
        Schema.Struct({
          [COMPUTE_SESSION_HEADER]: Schema.String,
          "x-dossier-dek": Schema.String,
          "x-document-name": Schema.String,
          "x-document-format": Schema.String,
          "x-document-tags": Schema.optional(Schema.String),
          "x-document-collections": Schema.optional(Schema.String),
        }),
      )
      .addSuccess(Schema.Struct({ documentId: Schema.String.pipe(Schema.brand("DocumentId")) }), {
        status: 201,
      }),
  ),
)

export interface UploadDocumentOptions {
  readonly file: Uint8Array
  readonly name: string
  readonly format: "pdf" | "jpg" | "png"
  readonly dekBase64Url: string
  readonly sessionToken: string
  readonly tagNames?: ReadonlyArray<string>
  readonly collectionIds?: ReadonlyArray<CollectionId>
}

export const uploadDocument = (options: UploadDocumentOptions): Effect.Effect<DocumentId, UploadError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(ComputeUploadApi, {
      baseUrl: import.meta.env.VITE_COMPUTE_URL ?? "",
    })
    const result = yield* client.upload.uploadDocument({
      payload: options.file,
      headers: {
        [COMPUTE_SESSION_HEADER]: options.sessionToken,
        "x-dossier-dek": options.dekBase64Url,
        "x-document-name": options.name,
        "x-document-format": options.format,
        ...(options.tagNames && options.tagNames.length > 0
          ? { "x-document-tags": JSON.stringify(options.tagNames) }
          : {}),
        ...(options.collectionIds && options.collectionIds.length > 0
          ? { "x-document-collections": JSON.stringify(options.collectionIds) }
          : {}),
      },
    })
    return result.documentId
  }).pipe(Effect.mapError((e) => new UploadError({ message: String(e) })))
