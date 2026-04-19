import * as Context from "effect/Context"
import * as Rpc from "@effect/rpc/Rpc"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import * as RpcMiddleware from "@effect/rpc/RpcMiddleware"
import * as Schema from "effect/Schema"
import {
  DocumentId,
  TagId,
  CollectionId,
  UserId,
  KdfParams,
  WatermarkConfig,
  DocumentMeta,
  Tag,
  Collection,
  ListDocumentsParams,
  DocumentListPage,
} from "./domain.js"
import {
  InvalidSessionError,
  NotFoundError,
  ConflictError,
  InternalError,
  InvalidCredentialsError,
  TotpInvalidError,
  TotpNotConfirmedError,
  UsernameTakenError,
  CircularCollectionError,
  CollectionHasChildrenError,
} from "./errors.js"

// --- Auth context (injected by middleware) ---

export class AuthContext extends Context.Tag("@dossier/storage/AuthContext")<
  AuthContext,
  { readonly userId: UserId }
>() {}

// --- Middleware ---

export class StorageAuth extends RpcMiddleware.Tag<StorageAuth>()(
  "@dossier/storage/StorageAuth",
  { provides: AuthContext, failure: InvalidSessionError }
) {}

export const STORAGE_SESSION_HEADER = "x-dossier-session" as const

// --- Unauthenticated RPCs ---

export class StorageAuthRpcs extends RpcGroup.make(
  Rpc.make("GetKdfParams", {
    payload: { username: Schema.String },
    success: Schema.Struct({
      kdfParams: KdfParams,
      encryptedDek: Schema.String,
      dekIv: Schema.String,
    }),
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("Register", {
    payload: {
      username: Schema.String,
      authKey: Schema.String,   // HKDF("auth", Argon2id(password, kdfParams)) — never the raw password
      kdfParams: KdfParams,
      encryptedDek: Schema.String,
      dekIv: Schema.String,
    },
    success: Schema.Struct({
      totpUri: Schema.String,
      userId: Schema.String,
    }),
    error: Schema.Union(UsernameTakenError, InternalError),
  }),
  Rpc.make("ConfirmTotp", {
    payload: { username: Schema.String, totpCode: Schema.String },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, TotpInvalidError, InternalError),
  }),
  Rpc.make("Login", {
    payload: {
      username: Schema.String,
      authKey: Schema.String,   // HKDF("auth", Argon2id(password, kdfParams)) — never the raw password
      totpCode: Schema.String,
    },
    success: Schema.Struct({
      sessionToken: Schema.String,
      encryptedDek: Schema.String,
      dekIv: Schema.String,
    }),
    error: Schema.Union(InvalidCredentialsError, TotpInvalidError, TotpNotConfirmedError, InternalError),
  })
) {}

// --- Session RPCs (authenticated) ---

export class StorageSessionRpcs extends RpcGroup.make(
  Rpc.make("Logout", {
    payload: Schema.Void,
    success: Schema.Void,
    error: InternalError,
  })
) {}

// --- Document RPCs (authenticated) ---

export class StorageDocumentRpcs extends RpcGroup.make(
  Rpc.make("ListDocuments", {
    payload: ListDocumentsParams,
    success: DocumentListPage,
    error: InternalError,
  }),
  Rpc.make("GetDocumentMeta", {
    payload: { documentId: DocumentId },
    success: DocumentMeta,
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("CreateDocumentMeta", {
    payload: {
      name: Schema.String,
      format: Schema.Literal("pdf", "jpg", "png"),
      tagNames: Schema.Array(Schema.String),
      collectionIds: Schema.Array(CollectionId),
    },
    success: Schema.Struct({
      documentId: DocumentId,
      blobKey: Schema.String,
    }),
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("ConfirmBlobUpload", {
    payload: { documentId: DocumentId, encryptedSize: Schema.Number },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  }),
  // Blob upload is NOT an RPC — it uses PUT /blobs/:blobKey (raw binary body).
  // See design decision D1.
  Rpc.make("DownloadDocumentBlob", {
    payload: { documentId: DocumentId },
    success: Schema.Uint8Array,
    error: Schema.Union(NotFoundError, InternalError),
    stream: true,
  }),
  Rpc.make("RenameDocument", {
    payload: { documentId: DocumentId, name: Schema.String },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("DeleteDocument", {
    payload: { documentId: DocumentId },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("UpdateDocumentTags", {
    payload: {
      documentId: DocumentId,
      tagNames: Schema.Array(Schema.String),
    },
    success: Schema.Array(Tag),
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("UpdateDocumentCollections", {
    payload: {
      documentId: DocumentId,
      collectionIds: Schema.Array(CollectionId),
    },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  })
) {}

// --- Tag RPCs (authenticated) ---

export class StorageTagRpcs extends RpcGroup.make(
  Rpc.make("ListTags", {
    payload: Schema.Void,
    success: Schema.Array(Tag),
    error: InternalError,
  }),
  Rpc.make("DeleteTag", {
    payload: { tagId: TagId },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  })
) {}

// --- Collection RPCs (authenticated) ---

export class StorageCollectionRpcs extends RpcGroup.make(
  Rpc.make("ListCollections", {
    payload: Schema.Void,
    success: Schema.Array(Collection),
    error: InternalError,
  }),
  Rpc.make("GetCollection", {
    payload: { collectionId: CollectionId },
    success: Collection,
    error: Schema.Union(NotFoundError, InternalError),
  }),
  Rpc.make("CreateCollection", {
    payload: {
      name: Schema.String,
      parentId: Schema.NullOr(CollectionId),
    },
    success: Collection,
    error: Schema.Union(NotFoundError, ConflictError, InternalError),
  }),
  Rpc.make("UpdateCollection", {
    payload: {
      collectionId: CollectionId,
      name: Schema.optional(Schema.String),
      watermark: Schema.optional(Schema.NullOr(WatermarkConfig)),
    },
    success: Collection,
    error: Schema.Union(NotFoundError, ConflictError, InternalError),
  }),
  Rpc.make("DeleteCollection", {
    payload: Schema.Struct({
      collectionId: CollectionId,
      recursive: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    }),
    success: Schema.Struct({ deletedCount: Schema.Number }),
    error: Schema.Union(NotFoundError, CollectionHasChildrenError, InternalError),
  }),
  Rpc.make("MoveCollection", {
    payload: {
      collectionId: CollectionId,
      newParentId: Schema.NullOr(CollectionId),
    },
    success: Collection,
    error: Schema.Union(NotFoundError, CircularCollectionError, ConflictError, InternalError),
  }),
  Rpc.make("AddDocumentToCollection", {
    payload: { collectionId: CollectionId, documentId: DocumentId },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, ConflictError, InternalError),
  }),
  Rpc.make("RemoveDocumentFromCollection", {
    payload: { collectionId: CollectionId, documentId: DocumentId },
    success: Schema.Void,
    error: Schema.Union(NotFoundError, InternalError),
  })
) {}

// --- Account RPCs (authenticated) ---

export class StorageAccountRpcs extends RpcGroup.make(
  Rpc.make("ChangePassword", {
    payload: {
      oldAuthKey: Schema.String,    // proves identity against stored hash
      newAuthKey: Schema.String,    // new auth key derived from new password + newKdfParams
      newKdfParams: KdfParams,      // client-generated (new salt)
      newEncryptedDek: Schema.String,
      newDekIv: Schema.String,
    },
    success: Schema.Void,
    error: Schema.Union(InvalidCredentialsError, InternalError),
  }),
  Rpc.make("UpdateEncryptedDek", {
    payload: {
      newEncryptedDek: Schema.String,
      newDekIv: Schema.String,
    },
    success: Schema.Void,
    error: InternalError,
  })
) {}

// --- Root group (merges all, applies auth middleware where required) ---

export class StorageRpcs extends RpcGroup.make()
  .merge(StorageAuthRpcs)
  .merge(StorageSessionRpcs.middleware(StorageAuth))
  .merge(StorageDocumentRpcs.middleware(StorageAuth))
  .merge(StorageTagRpcs.middleware(StorageAuth))
  .merge(StorageCollectionRpcs.middleware(StorageAuth))
  .merge(StorageAccountRpcs.middleware(StorageAuth)) {}
