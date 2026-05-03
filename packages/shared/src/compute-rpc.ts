import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as RpcMiddleware from "@effect/rpc/RpcMiddleware";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

import { DocumentId, ExportFormat, ExportStructure, KeyRotationProgress } from "./domain.js";
import {
  InvalidSessionError,
  NotFoundError,
  InternalError,
  DecryptionFailedError,
  EncryptionFailedError,
  WatermarkFailedError,
  ArchiveFailedError,
} from "./errors.js";

// --- Auth context (injected by middleware) ---

export class ComputeAuthContext extends Context.Tag("@dossier/compute/AuthContext")<
  ComputeAuthContext,
  { readonly sessionToken: string }
>() {}

// --- Middleware ---

export class ComputeAuth extends RpcMiddleware.Tag<ComputeAuth>()("@dossier/compute/ComputeAuth", {
  provides: ComputeAuthContext,
  failure: InvalidSessionError,
}) {}

export const COMPUTE_SESSION_HEADER = "x-dossier-session" as const;

// --- Compute RPCs (all authenticated) ---
// Note: file upload is NOT an RPC — the compute service exposes POST /upload
// (multipart: file bytes + metadata; x-dossier-session + x-dossier-dek headers).
// See design decision D1.

export class ComputeRpcs extends RpcGroup.make(
  Rpc.make("Preview", {
    payload: { dek: Schema.String, documentId: DocumentId },
    success: Schema.Uint8Array,
    error: Schema.Union(NotFoundError, DecryptionFailedError, InternalError),
    stream: true,
  }),
  Rpc.make("WatermarkPreview", {
    payload: {
      dek: Schema.String,
      documentId: DocumentId,
      watermarkText: Schema.String,
    },
    success: Schema.Uint8Array,
    error: Schema.Union(NotFoundError, DecryptionFailedError, WatermarkFailedError, InternalError),
    stream: true,
  }),
  Rpc.make("Export", {
    payload: Schema.Struct({
      dek: Schema.String,
      docIds: Schema.Array(DocumentId),
      exportFormat: ExportFormat,
      structureMode: Schema.optionalWith(ExportStructure, { default: () => "flatten" as const }),
      archivePaths: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
      watermarkText: Schema.optional(Schema.String),
    }),
    success: Schema.Uint8Array,
    error: Schema.Union(NotFoundError, DecryptionFailedError, WatermarkFailedError, ArchiveFailedError, InternalError),
    stream: true,
  }),
  Rpc.make("RotateKey", {
    payload: {
      oldDek: Schema.String,
      newDek: Schema.String,
      newEncryptedDek: Schema.String,
      newDekIv: Schema.String,
    },
    success: KeyRotationProgress,
    error: Schema.Union(NotFoundError, DecryptionFailedError, EncryptionFailedError, InternalError),
    stream: true,
  }),
).middleware(ComputeAuth) {}
