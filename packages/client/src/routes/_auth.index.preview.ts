import { COMPUTE_SESSION_HEADER } from "@dossier/shared";
import type { DocumentFormat, DocumentId } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { bytesToBase64Url } from "../lib/crypto.js";
import { ComputeRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

export interface PreviewTarget {
  readonly documentId: DocumentId;
  readonly format: DocumentFormat;
  readonly name: string;
  readonly watermarkText?: string;
}

export const previewAtom = Atom.writable<PreviewTarget | null, PreviewTarget | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const previewDataAtom = ComputeRpc.runtime
  .atom((get) => {
    const target = get(previewAtom);
    if (!target) return Effect.succeed(null as Uint8Array | null);
    const session = get(sessionAtom) as UnlockedSession;
    return Effect.gen(function* () {
      const client = yield* ComputeRpc;
      const dek = bytesToBase64Url(session.dek);
      const headers = { headers: { [COMPUTE_SESSION_HEADER]: session.token } };
      const stream =
        target.watermarkText !== undefined
          ? client("WatermarkPreview", { dek, documentId: target.documentId, watermarkText: target.watermarkText }, headers)
          : client("Preview", { dek, documentId: target.documentId }, headers);
      return (yield* Stream.runFold(stream, new Uint8Array(0), (acc, chunk) => {
        const next = new Uint8Array(acc.length + chunk.length);
        next.set(acc, 0);
        next.set(chunk, acc.length);
        return next;
      })) as Uint8Array | null;
    });
  })
  .pipe(Atom.keepAlive);

// Pending watermark preview: holds the doc to preview + default text before user confirms
export interface WatermarkPreviewPending {
  readonly documentId: DocumentId;
  readonly format: DocumentFormat;
  readonly name: string;
  readonly watermarkText: string;
}

export const watermarkPreviewPendingAtom = Atom.writable<WatermarkPreviewPending | null, WatermarkPreviewPending | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);
