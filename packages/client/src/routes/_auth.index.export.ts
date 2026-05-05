import { COMPUTE_SESSION_HEADER } from "@dossier/shared";
import type { DocumentId, DocumentMeta, ExportFormat, ExportStructure } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { bytesToBase64Url } from "../lib/crypto.js";
import { ComputeRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

export interface ExportDialogState {
  readonly selectedDocIds: ReadonlyArray<DocumentId>;
  readonly format: ExportFormat;
  readonly structureMode: ExportStructure;
  readonly watermarkText: string;
}

export const exportOpenAtom = Atom.writable<boolean, boolean>(
  () => false,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const exportDialogAtom = Atom.writable<ExportDialogState, ExportDialogState>(
  () => ({ selectedDocIds: [], format: "zip", structureMode: "flatten", watermarkText: "" }),
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openExportDialog = (docs: ReadonlyArray<DocumentMeta>): ExportDialogState => ({
  selectedDocIds: docs.map((d) => d.id),
  format: "zip",
  structureMode: "flatten",
  watermarkText: "",
});

export const toggleExportDoc = (state: ExportDialogState, docId: DocumentId): ExportDialogState => ({
  ...state,
  selectedDocIds: state.selectedDocIds.includes(docId)
    ? state.selectedDocIds.filter((id) => id !== docId)
    : [...state.selectedDocIds, docId],
});

export const selectAllDocs = (state: ExportDialogState, docs: ReadonlyArray<DocumentMeta>): ExportDialogState => ({
  ...state,
  selectedDocIds: docs.map((d) => d.id),
});

export const deselectAllDocs = (state: ExportDialogState): ExportDialogState => ({
  ...state,
  selectedDocIds: [],
});

export const setExportFormat = (state: ExportDialogState, format: ExportFormat): ExportDialogState => ({
  ...state,
  format,
});

export const setExportStructureMode = (state: ExportDialogState, structureMode: ExportStructure): ExportDialogState => ({
  ...state,
  structureMode,
});

export const setExportWatermarkText = (state: ExportDialogState, watermarkText: string): ExportDialogState => ({
  ...state,
  watermarkText,
});

export const exportAtom = ComputeRpc.runtime.fn<{ state: ExportDialogState; docs: ReadonlyArray<DocumentMeta> }>()(
  ({ state, docs }, get) => {
    const session = get(sessionAtom) as UnlockedSession;
    return Effect.gen(function* () {
      const client = yield* ComputeRpc;

      const archivePaths: Record<string, string> =
        state.structureMode === "preserve"
          ? Object.fromEntries(docs.filter((d) => state.selectedDocIds.includes(d.id)).map((d) => [d.id, d.name]))
          : {};

      const stream = client(
        "Export",
        {
          dek: bytesToBase64Url(session.dek),
          docIds: [...state.selectedDocIds],
          exportFormat: state.format,
          structureMode: state.structureMode,
          ...(state.structureMode === "preserve" ? { archivePaths } : {}),
          ...(state.watermarkText.trim() ? { watermarkText: state.watermarkText.trim() } : {}),
        },
        { headers: { [COMPUTE_SESSION_HEADER]: session.token } },
      );

      const bytes = yield* Stream.runFold(stream, new Uint8Array(0), (acc, chunk) => {
        const next = new Uint8Array(acc.length + chunk.length);
        next.set(acc, 0);
        next.set(chunk, acc.length);
        return next;
      });

      const ext = state.format === "zip" ? "zip" : "tar.gz";
      const mimeType = state.format === "zip" ? "application/zip" : "application/gzip";
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }).pipe(Reactivity.mutation({}));
  },
);
