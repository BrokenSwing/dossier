import * as Schema from "effect/Schema";

// --- Common ---

export class InvalidSessionError extends Schema.TaggedError<InvalidSessionError>()("InvalidSessionError", {
  message: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  message: Schema.String,
}) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  message: Schema.String,
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()("InternalError", {
  message: Schema.String,
}) {}

// --- Auth ---

export class InvalidCredentialsError extends Schema.TaggedError<InvalidCredentialsError>()("InvalidCredentialsError", {
  message: Schema.String,
}) {}

export class TotpInvalidError extends Schema.TaggedError<TotpInvalidError>()("TotpInvalidError", {
  message: Schema.String,
}) {}

export class TotpNotConfirmedError extends Schema.TaggedError<TotpNotConfirmedError>()("TotpNotConfirmedError", {
  message: Schema.String,
}) {}

export class UsernameTakenError extends Schema.TaggedError<UsernameTakenError>()("UsernameTakenError", {
  message: Schema.String,
}) {}

// --- Collections ---

export class CircularCollectionError extends Schema.TaggedError<CircularCollectionError>()("CircularCollectionError", {
  message: Schema.String,
}) {}

export class CollectionHasChildrenError extends Schema.TaggedError<CollectionHasChildrenError>()("CollectionHasChildrenError", {
  message: Schema.String,
}) {}

// --- Compute ---

export class DecryptionFailedError extends Schema.TaggedError<DecryptionFailedError>()("DecryptionFailedError", {
  message: Schema.String,
}) {}

export class EncryptionFailedError extends Schema.TaggedError<EncryptionFailedError>()("EncryptionFailedError", {
  message: Schema.String,
}) {}

export class WatermarkFailedError extends Schema.TaggedError<WatermarkFailedError>()("WatermarkFailedError", {
  message: Schema.String,
}) {}

export class ArchiveFailedError extends Schema.TaggedError<ArchiveFailedError>()("ArchiveFailedError", {
  message: Schema.String,
}) {}
