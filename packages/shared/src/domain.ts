import * as Schema from "effect/Schema"

// --- Branded IDs ---

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"))
export const TagId = Schema.String.pipe(Schema.brand("TagId"))
export const CollectionId = Schema.String.pipe(Schema.brand("CollectionId"))
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type DocumentId = typeof DocumentId.Type
export type TagId = typeof TagId.Type
export type CollectionId = typeof CollectionId.Type
export type UserId = typeof UserId.Type

// --- Enums / Literals ---

export const DocumentFormat = Schema.Literal("pdf", "jpg", "png")
export type DocumentFormat = typeof DocumentFormat.Type

export const ExportFormat = Schema.Literal("zip", "tar.gz")
export type ExportFormat = typeof ExportFormat.Type

export const ExportStructure = Schema.Literal("flatten", "preserve")
export type ExportStructure = typeof ExportStructure.Type

// --- Value schemas ---

export class KdfParams extends Schema.Class<KdfParams>("KdfParams")({
  memory: Schema.Number,
  iterations: Schema.Number,
  parallelism: Schema.Number,
  salt: Schema.String,
}) {}

export class WatermarkConfig extends Schema.Class<WatermarkConfig>("WatermarkConfig")({
  text: Schema.String,
}) {}

export class DocumentMeta extends Schema.Class<DocumentMeta>("DocumentMeta")({
  id: DocumentId,
  name: Schema.String,
  format: DocumentFormat,
  encryptedSize: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  tags: Schema.Array(Schema.String),
  collectionIds: Schema.Array(CollectionId),
}) {}

export class Tag extends Schema.Class<Tag>("Tag")({
  id: TagId,
  name: Schema.String,
  documentCount: Schema.Number,
}) {}

export class Collection extends Schema.Class<Collection>("Collection")({
  id: CollectionId,
  name: Schema.String,
  parentId: Schema.NullOr(CollectionId),
  watermark: Schema.NullOr(WatermarkConfig),
  createdAt: Schema.String,
}) {}

// --- List / pagination ---

export class ListDocumentsParams extends Schema.Class<ListDocumentsParams>("ListDocumentsParams")({
  sortField: Schema.optionalWith(Schema.Literal("name", "createdAt", "updatedAt"), { default: () => "createdAt" as const }),
  sortDirection: Schema.optionalWith(Schema.Literal("asc", "desc"), { default: () => "desc" as const }),
  nameFilter: Schema.optional(Schema.String),
  tagFilter: Schema.optional(Schema.Array(TagId)),
  collectionFilter: Schema.optional(CollectionId),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optionalWith(Schema.Number, { default: () => 50 }),
}) {}

export class DocumentListPage extends Schema.Class<DocumentListPage>("DocumentListPage")({
  documents: Schema.Array(DocumentMeta),
  nextCursor: Schema.NullOr(Schema.String),
}) {}

// --- Streaming progress ---

export class KeyRotationProgress extends Schema.Class<KeyRotationProgress>("KeyRotationProgress")({
  processed: Schema.Number,
  total: Schema.Number,
  currentDocumentId: Schema.NullOr(DocumentId),
  phase: Schema.Literal("re-encrypting", "uploading", "finalizing"),
}) {}
