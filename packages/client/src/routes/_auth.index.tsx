import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { Collection, CollectionId, DocumentMeta, ExportFormat, ExportStructure, Tag, TagId } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute } from "@tanstack/react-router";
import * as pdfjsLib from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import React from "react";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";
import {
  addEditTag,
  confirmDeleteAtom,
  deleteAtom,
  editDocumentDialogAtom,
  openEditDocumentDialog,
  openRenameDialog,
  removeEditTag,
  renameAtom,
  renameDialogAtom,
  setEditTagInput,
  setRenameName,
  toggleEditCollection,
  updateCollectionsAtom,
  updateTagsAtom,
} from "./_auth.index.actions.js";
import {
  confirmDeleteCollectionAtom,
  createCollectionAtom,
  createCollectionDialogAtom,
  deleteCollectionAtom,
  editCollectionDialogAtom,
  moveCollectionAtom,
  moveCollectionDialogAtom,
  selectedCollectionAtom,
  setCreateCollectionName,
  setEditCollectionName,
  setEditWatermarkText,
  setMoveCollectionParent,
  updateCollectionAtom,
} from "./_auth.index.collections.js";
import {
  deselectAllDocs,
  exportAtom,
  exportDialogAtom,
  exportOpenAtom,
  openExportDialog,
  selectAllDocs,
  setExportFormat,
  setExportStructureMode,
  setExportWatermarkText,
  toggleExportDoc,
} from "./_auth.index.export.js";
import { previewAtom, previewDataAtom, watermarkPreviewPendingAtom, type PreviewTarget } from "./_auth.index.preview.js";
import { clearTags, selectedTagsAtom, toggleTag } from "./_auth.index.tags.js";
import { Route as authRoute } from "./_auth.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
import { appendCursor, docListAtom, setNameFilter, toggleSort, type SortDirection, type SortField } from "./_auth.index.docList.js";
import {
  addTag,
  initialUploadFormState,
  removeTag,
  setFile,
  setTagInput,
  setUploadName,
  toggleCollection,
  uploadAtom,
  uploadFormAtom,
  uploadOpenAtom,
} from "./_auth.index.upload.js";

export const Route = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  component: DocumentsPage,
});

// --- Page component ---

function DocumentsPage() {
  const session = useAtomValue(sessionAtom) as UnlockedSession;
  const state = useAtomValue(docListAtom);
  const setState = useAtomSet(docListAtom);
  const setUploadOpen = useAtomSet(uploadOpenAtom);
  const selectedCollection = useAtomValue(selectedCollectionAtom);
  const selectedTags = useAtomValue(selectedTagsAtom);
  const setSelectedTags = useAtomSet(selectedTagsAtom);
  const setExportOpen = useAtomSet(exportOpenAtom);
  const setExportDialog = useAtomSet(exportDialogAtom);

  const tagsQueryAtom = StorageRpc.query("ListTags", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
    reactivityKeys: { documents: [] },
  });
  const tagsResult = useAtomValue(tagsQueryAtom);
  const allTags: ReadonlyArray<Tag> = Result.isSuccess(tagsResult) ? tagsResult.value : [];
  const activeTagNames = selectedTags.map((id) => allTags.find((t) => t.id === id)?.name ?? id);

  const tagFilter: ReadonlyArray<TagId> | undefined = selectedTags.length > 0 ? selectedTags : undefined;

  // Load first page of docs with current filters so export dialog can pre-select them
  const exportDocsQueryAtom = StorageRpc.query(
    "ListDocuments",
    {
      sortField: state.sortField,
      sortDirection: state.sortDirection,
      nameFilter: state.nameFilter || undefined,
      collectionFilter: selectedCollection ?? undefined,
      tagFilter,
      limit: 200,
    },
    { headers: { [STORAGE_SESSION_HEADER]: session.token }, reactivityKeys: { documents: [] } },
  );
  const exportDocsResult = useAtomValue(exportDocsQueryAtom);
  const visibleDocs: ReadonlyArray<DocumentMeta> = Result.isSuccess(exportDocsResult) ? exportDocsResult.value.documents : [];

  function openExport() {
    setExportDialog(openExportDialog(visibleDocs));
    setExportOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Documents</h1>
        <input
          type="search"
          placeholder="Search by name…"
          value={state.nameFilter}
          onChange={(e) => setState(setNameFilter(state, e.target.value))}
          className="input min-w-0 flex-1 sm:max-w-sm"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={openExport} className="btn btn-secondary">
            Export
          </button>
          <button type="button" onClick={() => setUploadOpen(true)} className="btn btn-primary">
            Upload
          </button>
        </div>
      </div>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Tags:</span>
          {selectedTags.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedTags(toggleTag(selectedTags, id))}
              aria-label={`Remove tag filter ${activeTagNames[i]}`}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
            >
              {activeTagNames[i]}
              <span aria-hidden="true" className="opacity-60">
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedTags(clearTags(selectedTags))}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <SortButton
                  label="Name"
                  active={state.sortField === "name"}
                  direction={state.sortDirection}
                  onClick={() => setState(toggleSort(state, "name"))}
                />
              </th>
              <th className="hidden py-2.5 pr-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:table-cell">Format</th>
              <th className="hidden py-2.5 pr-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:table-cell">Tags</th>
              <th className="hidden py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:table-cell">
                <SortButton
                  label="Date"
                  active={state.sortField === "createdAt"}
                  direction={state.sortDirection}
                  onClick={() => setState(toggleSort(state, "createdAt"))}
                />
              </th>
              <th className="py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase" />
            </tr>
          </thead>
          <tbody>
            {state.cursors.map((cursor, i) => (
              <DocumentPageRows
                key={cursor ?? "__first__"}
                sortField={state.sortField}
                sortDirection={state.sortDirection}
                nameFilter={state.nameFilter || undefined}
                collectionFilter={selectedCollection ?? undefined}
                tagFilter={tagFilter}
                cursor={cursor}
                token={session.token}
                isLastPage={i === state.cursors.length - 1}
                onLoadMore={(nextCursor) => setState(appendCursor(state, nextCursor))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <UploadDialog session={session} />
      <ExportDialog />
      <WatermarkPreviewDialog />
      <DocumentPreview />
      <RenameDialog />
      <EditDocumentDialog session={session} />
      <DeleteConfirmDialog />
      <CreateCollectionDialog />
      <EditCollectionDialog />
      <DeleteCollectionConfirmDialog />
      <MoveCollectionDialog />
    </div>
  );
}

// --- Upload dialog ---

function UploadDialog({ session }: { session: UnlockedSession }) {
  const open = useAtomValue(uploadOpenAtom);
  const setOpen = useAtomSet(uploadOpenAtom);
  const form = useAtomValue(uploadFormAtom);
  const setForm = useAtomSet(uploadFormAtom);
  const upload = useAtomSet(uploadAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tagsQueryAtom = StorageRpc.query("ListTags", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
  });
  const tagsResult = useAtomValue(tagsQueryAtom);

  const collectionsQueryAtom = StorageRpc.query("ListCollections", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
  });
  const collectionsResult = useAtomValue(collectionsQueryAtom);

  if (!open) return null;

  const availableTags: ReadonlyArray<Tag> = Result.isSuccess(tagsResult) ? tagsResult.value : [];
  const filteredSuggestions = form.tagInput.trim()
    ? availableTags.filter((t) => t.name.toLowerCase().includes(form.tagInput.toLowerCase()) && !form.selectedTags.includes(t.name)).slice(0, 5)
    : [];

  const collections: ReadonlyArray<Collection> = Result.isSuccess(collectionsResult) ? collectionsResult.value : [];

  const isValid = form.file !== null && form.name.trim().length > 0;

  function close() {
    setOpen(false);
    setForm(initialUploadFormState);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setLoading(true);
    setError(null);
    const exit = await upload();
    setLoading(false);
    if (exit._tag === "Success") {
      close();
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Upload failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="upload-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          Upload document
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">File</label>
            {form.file ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{form.file.name}</span>
                <label htmlFor="upload-file-replace" className="shrink-0 cursor-pointer text-xs text-primary hover:text-primary/80">
                  Change
                  <input
                    id="upload-file-replace"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setForm(setFile(form, f));
                    }}
                  />
                </label>
              </div>
            ) : (
              <input
                id="upload-file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setForm(setFile(form, f));
                }}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
              />
            )}
          </div>

          <div>
            <label htmlFor="upload-name" className="mb-1 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="upload-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm(setUploadName(form, e.target.value))}
              className="input w-full"
              placeholder="Document name"
            />
          </div>

          <div>
            <label htmlFor="upload-tag-input" className="mb-1 block text-sm font-medium text-foreground">
              Tags
            </label>
            {form.selectedTags.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {form.selectedTags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setForm(removeTag(form, tag))}
                      className="opacity-60 hover:opacity-100"
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                type="text"
                value={form.tagInput}
                onChange={(e) => setForm(setTagInput(form, e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && form.tagInput.trim()) {
                    e.preventDefault();
                    setForm(addTag(form, form.tagInput.trim()));
                  }
                }}
                id="upload-tag-input"
                className="input w-full"
                placeholder="Add tag and press Enter…"
              />
              {filteredSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
                  {filteredSuggestions.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm(addTag(form, t.name));
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/50 transition-colors"
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {collections.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Collections</label>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2">
                {collections.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.selectedCollectionIds.includes(c.id)}
                      onChange={() => setForm(toggleCollection(form, c.id))}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={close} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={!isValid || loading} className="btn btn-primary">
              {loading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Per-page rows ---

interface PageRowsProps {
  readonly sortField: SortField;
  readonly sortDirection: SortDirection;
  readonly nameFilter: string | undefined;
  readonly collectionFilter: CollectionId | undefined;
  readonly tagFilter: ReadonlyArray<TagId> | undefined;
  readonly cursor: string | undefined;
  readonly token: string;
  readonly isLastPage: boolean;
  readonly onLoadMore: (nextCursor: string) => void;
}

function DocumentPageRows({
  sortField,
  sortDirection,
  nameFilter,
  collectionFilter,
  tagFilter,
  cursor,
  token,
  isLastPage,
  onLoadMore,
}: PageRowsProps) {
  const queryAtom = StorageRpc.query(
    "ListDocuments",
    { sortField, sortDirection, nameFilter, collectionFilter, tagFilter, cursor, limit: 20 },
    { headers: { [STORAGE_SESSION_HEADER]: token }, reactivityKeys: { documents: [] } },
  );

  const result = useAtomValue(queryAtom);

  if (!Result.isSuccess(result)) {
    if (!isLastPage) return null;
    if (Result.isFailure(result)) {
      return (
        <tr>
          <td colSpan={5} className="py-8 text-center text-sm text-destructive">
            Failed to load documents.
          </td>
        </tr>
      );
    }
    return (
      <tr>
        <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </td>
      </tr>
    );
  }

  const { documents, nextCursor } = result.value;

  if (documents.length === 0 && !cursor) {
    return (
      <tr>
        <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
          No documents yet.
        </td>
      </tr>
    );
  }

  return (
    <>
      {documents.map((doc) => (
        <DocumentRow key={doc.id} doc={doc} />
      ))}
      {isLastPage && nextCursor && (
        <tr>
          <td colSpan={5} className="pt-4 pb-2 text-center">
            <button type="button" onClick={() => onLoadMore(nextCursor)} className="text-sm text-primary hover:text-primary/80">
              Load more
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

// --- Single row ---

function DocumentRow({ doc }: { doc: DocumentMeta }) {
  const setPreview = useAtomSet(previewAtom);
  const setRenameDialog = useAtomSet(renameDialogAtom);
  const setEditDialog = useAtomSet(editDocumentDialogAtom);
  const setConfirmDelete = useAtomSet(confirmDeleteAtom);
  const setWatermarkPending = useAtomSet(watermarkPreviewPendingAtom);
  const session = useAtomValue(sessionAtom) as UnlockedSession;
  const target: PreviewTarget = { documentId: doc.id, format: doc.format, name: doc.name };

  const collectionsQueryAtom = StorageRpc.query("ListCollections", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
    reactivityKeys: { collections: [] },
  });
  const collectionsResult = useAtomValue(collectionsQueryAtom);
  const collections: ReadonlyArray<Collection> = Result.isSuccess(collectionsResult) ? collectionsResult.value : [];

  function openWatermarkPreview(e: React.MouseEvent) {
    e.stopPropagation();
    const collectionWatermark =
      doc.collectionIds.map((cid) => collections.find((c) => c.id === cid)?.watermark?.text).find((t) => t !== undefined) ?? "";
    setWatermarkPending({ documentId: doc.id, format: doc.format, name: doc.name, watermarkText: collectionWatermark });
  }

  return (
    <tr className="group border-b border-border cursor-pointer transition-colors hover:bg-muted/30 last:border-0" onClick={() => setPreview(target)}>
      <td className="px-4 py-3 font-medium text-foreground">{doc.name}</td>
      <td className="hidden py-3 pr-4 sm:table-cell">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {doc.format}
        </span>
      </td>
      <td className="hidden py-3 pr-4 md:table-cell">
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-secondary/60 px-1.5 py-0.5 text-xs text-secondary-foreground">
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="hidden py-3 whitespace-nowrap text-sm text-muted-foreground sm:table-cell">{formatDate(doc.createdAt)}</td>
      <td className="py-3 whitespace-nowrap text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Rename ${doc.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setRenameDialog(openRenameDialog(doc));
            }}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Edit tags and collections for ${doc.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditDialog(openEditDocumentDialog(doc));
            }}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label={`Watermark preview of ${doc.name}`}
            onClick={openWatermarkPreview}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Watermark
          </button>
          <button
            type="button"
            aria-label={`Delete ${doc.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(doc);
            }}
            className="rounded px-2 py-1 text-xs text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// --- UI helpers ---

function SortButton({ label, active, direction, onClick }: { label: string; active: boolean; direction: SortDirection; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-xs font-semibold tracking-wide uppercase transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {active && <span className="text-primary">{direction === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// --- Create collection dialog ---

function CreateCollectionDialog() {
  const state = useAtomValue(createCollectionDialogAtom);
  const setState = useAtomSet(createCollectionDialogAtom);
  const create = useAtomSet(createCollectionAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!state) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !state.name.trim()) return;
    setLoading(true);
    setError(null);
    const exit = await create({ name: state.name.trim(), parentId: state.parentId });
    setLoading(false);
    if (exit._tag === "Success") {
      setState(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Failed to create collection.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-col-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="create-col-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          {state.parentId ? "New sub-collection" : "New collection"}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="create-col-name" className="mb-1 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="create-col-name"
              type="text"
              value={state.name}
              onChange={(e) => setState(setCreateCollectionName(state, e.target.value))}
              className="input w-full"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setState(null)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={!state.name.trim() || loading} className="btn btn-primary">
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Edit collection dialog (rename + watermark) ---

function EditCollectionDialog() {
  const state = useAtomValue(editCollectionDialogAtom);
  const setState = useAtomSet(editCollectionDialogAtom);
  const update = useAtomSet(updateCollectionAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!state) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !state.name.trim()) return;
    setLoading(true);
    setError(null);
    const exit = await update({
      collectionId: state.collectionId,
      name: state.name.trim(),
      watermarkText: state.watermarkText,
    });
    setLoading(false);
    if (exit._tag === "Success") {
      setState(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Failed to update collection.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-col-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="edit-col-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          Edit collection
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="edit-col-name" className="mb-1 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="edit-col-name"
              type="text"
              value={state.name}
              onChange={(e) => setState(setEditCollectionName(state, e.target.value))}
              className="input w-full"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="edit-col-watermark" className="mb-1 block text-sm font-medium text-foreground">
              Watermark text
            </label>
            <input
              id="edit-col-watermark"
              type="text"
              value={state.watermarkText}
              onChange={(e) => setState(setEditWatermarkText(state, e.target.value))}
              placeholder="Leave empty to remove watermark"
              className="input w-full"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setState(null)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={!state.name.trim() || loading} className="btn btn-primary">
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Delete collection confirmation dialog ---

function DeleteCollectionConfirmDialog() {
  const collection = useAtomValue(confirmDeleteCollectionAtom);
  const setCollection = useAtomSet(confirmDeleteCollectionAtom);
  const deleteCol = useAtomSet(deleteCollectionAtom, { mode: "promiseExit" });
  const [recursive, setRecursive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!collection) return null;

  async function handleDelete() {
    if (!collection) return;
    setLoading(true);
    setError(null);
    const exit = await deleteCol({ collectionId: collection.id, recursive });
    setLoading(false);
    if (exit._tag === "Success") {
      setCollection(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Delete failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-col-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="delete-col-dialog-title" className="mb-2 text-base font-semibold text-foreground">
          Delete collection
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Are you sure you want to delete <strong>{collection.name}</strong>?
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          Also delete all sub-collections
        </label>
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setCollection(null)} className="btn btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button type="button" onClick={handleDelete} disabled={loading} className="btn btn-danger">
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Move collection dialog ---

function MoveCollectionDialog() {
  const state = useAtomValue(moveCollectionDialogAtom);
  const setState = useAtomSet(moveCollectionDialogAtom);
  const move = useAtomSet(moveCollectionAtom, { mode: "promiseExit" });
  const session = useAtomValue(sessionAtom) as UnlockedSession;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const collectionsQueryAtom = StorageRpc.query("ListCollections", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
    reactivityKeys: { collections: [] },
  });
  const collectionsResult = useAtomValue(collectionsQueryAtom);
  const collections: ReadonlyArray<Collection> = Result.isSuccess(collectionsResult) ? collectionsResult.value : [];

  if (!state) return null;

  const candidates = collections.filter((c) => c.id !== state.collectionId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    setLoading(true);
    setError(null);
    const exit = await move({ collectionId: state.collectionId, newParentId: state.newParentId });
    setLoading(false);
    if (exit._tag === "Success") {
      setState(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Move failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-col-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="move-col-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          Move "{state.collectionName}"
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="move-col-parent" className="mb-1 block text-sm font-medium text-foreground">
              New parent
            </label>
            <select
              id="move-col-parent"
              value={state.newParentId ?? ""}
              onChange={(e) => setState(setMoveCollectionParent(state, e.target.value ? (e.target.value as CollectionId) : null))}
              className="input w-full"
            >
              <option value="">None (root level)</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setState(null)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? "Moving…" : "Move"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Rename dialog ---

function RenameDialog() {
  const state = useAtomValue(renameDialogAtom);
  const setState = useAtomSet(renameDialogAtom);
  const rename = useAtomSet(renameAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!state) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || !state.name.trim()) return;
    setLoading(true);
    setError(null);
    const exit = await rename({ documentId: state.documentId, name: state.name.trim() });
    setLoading(false);
    if (exit._tag === "Success") {
      setState(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Rename failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="rename-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          Rename document
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="rename-name" className="mb-1 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="rename-name"
              type="text"
              value={state.name}
              onChange={(e) => setState(setRenameName(state, e.target.value))}
              className="input w-full"
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setState(null)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={!state.name.trim() || loading} className="btn btn-primary">
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Edit document dialog (tags + collections) ---

function EditDocumentDialog({ session }: { session: UnlockedSession }) {
  const state = useAtomValue(editDocumentDialogAtom);
  const setState = useAtomSet(editDocumentDialogAtom);
  const updateTags = useAtomSet(updateTagsAtom, { mode: "promiseExit" });
  const updateCollections = useAtomSet(updateCollectionsAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tagsQueryAtom = StorageRpc.query("ListTags", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
  });
  const tagsResult = useAtomValue(tagsQueryAtom);

  const collectionsQueryAtom = StorageRpc.query("ListCollections", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
  });
  const collectionsResult = useAtomValue(collectionsQueryAtom);

  if (!state) return null;

  const availableTags: ReadonlyArray<Tag> = Result.isSuccess(tagsResult) ? tagsResult.value : [];
  const filteredSuggestions = state.tagInput.trim()
    ? availableTags.filter((t) => t.name.toLowerCase().includes(state.tagInput.toLowerCase()) && !state.selectedTags.includes(t.name)).slice(0, 5)
    : [];
  const collections: ReadonlyArray<Collection> = Result.isSuccess(collectionsResult) ? collectionsResult.value : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    setLoading(true);
    setError(null);
    const tagsExit = await updateTags({ documentId: state.documentId, tagNames: state.selectedTags });
    if (tagsExit._tag !== "Success") {
      setLoading(false);
      const cause = tagsExit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Failed to update tags.");
      return;
    }
    const colsExit = await updateCollections({
      documentId: state.documentId,
      collectionIds: state.selectedCollectionIds,
    });
    setLoading(false);
    if (colsExit._tag === "Success") {
      setState(null);
    } else {
      const cause = colsExit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Failed to update collections.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-doc-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="edit-doc-dialog-title" className="mb-4 text-base font-semibold text-foreground">
          Edit document
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="edit-tag-input" className="mb-1 block text-sm font-medium text-foreground">
              Tags
            </label>
            {state.selectedTags.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {state.selectedTags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setState(removeEditTag(state, tag))}
                      className="opacity-60 hover:opacity-100"
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                id="edit-tag-input"
                type="text"
                value={state.tagInput}
                onChange={(e) => setState(setEditTagInput(state, e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && state.tagInput.trim()) {
                    e.preventDefault();
                    setState(addEditTag(state, state.tagInput.trim()));
                  }
                }}
                className="input w-full"
                placeholder="Add tag and press Enter…"
              />
              {filteredSuggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
                  {filteredSuggestions.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setState(addEditTag(state, t.name));
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted/50 transition-colors"
                      >
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {collections.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Collections</label>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2">
                {collections.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={state.selectedCollectionIds.includes(c.id)}
                      onChange={() => setState(toggleEditCollection(state, c.id))}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setState(null)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Delete confirmation dialog ---

function DeleteConfirmDialog() {
  const doc = useAtomValue(confirmDeleteAtom);
  const setDoc = useAtomSet(confirmDeleteAtom);
  const deleteDoc = useAtomSet(deleteAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!doc) return null;

  async function handleDelete() {
    if (!doc) return;
    setLoading(true);
    setError(null);
    const exit = await deleteDoc({ documentId: doc.id });
    setLoading(false);
    if (exit._tag === "Success") {
      setDoc(null);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? cause.error.message : "Delete failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="delete-dialog-title" className="mb-2 text-base font-semibold text-foreground">
          Delete document
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Are you sure you want to delete <strong>{doc.name}</strong>? This cannot be undone.
        </p>
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDoc(null)} className="btn btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button type="button" onClick={handleDelete} disabled={loading} className="btn btn-danger">
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Export dialog ---

function ExportDialog() {
  const open = useAtomValue(exportOpenAtom);
  const setOpen = useAtomSet(exportOpenAtom);
  const dialogState = useAtomValue(exportDialogAtom);
  const setDialogState = useAtomSet(exportDialogAtom);
  const doExport = useAtomSet(exportAtom, { mode: "promiseExit" });
  const session = useAtomValue(sessionAtom) as UnlockedSession;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const allDocsQueryAtom = StorageRpc.query(
    "ListDocuments",
    { limit: 200 },
    { headers: { [STORAGE_SESSION_HEADER]: session.token }, reactivityKeys: { documents: [] } },
  );
  const allDocsResult = useAtomValue(allDocsQueryAtom);
  const allDocs: ReadonlyArray<DocumentMeta> = Result.isSuccess(allDocsResult) ? allDocsResult.value.documents : [];

  if (!open) return null;

  const state = dialogState;
  const allSelected = allDocs.length > 0 && allDocs.every((d) => state.selectedDocIds.includes(d.id));

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (state.selectedDocIds.length === 0) return;
    setLoading(true);
    setError(null);
    const exit = await doExport({ state, docs: allDocs });
    setLoading(false);
    if (exit._tag === "Success") {
      setOpen(false);
    } else {
      const cause = exit.cause;
      setError(cause._tag === "Fail" ? String((cause.error as { message?: unknown }).message ?? cause.error) : "Export failed. Please try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 flex w-full max-w-lg flex-col gap-4 rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="export-dialog-title" className="text-base font-semibold text-foreground">
          Export documents
        </h2>

        <form onSubmit={handleExport} className="flex flex-col gap-4">
          {/* Format */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">Format</p>
            <div className="flex gap-4">
              {(["zip", "tar.gz"] as ExportFormat[]).map((fmt) => (
                <label key={fmt} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="format"
                    value={fmt}
                    checked={state.format === fmt}
                    onChange={() => setDialogState(setExportFormat(state, fmt))}
                  />
                  {fmt}
                </label>
              ))}
            </div>
          </div>

          {/* Structure */}
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">Structure</p>
            <div className="flex gap-4">
              {(["flatten", "preserve"] as ExportStructure[]).map((mode) => (
                <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="structure"
                    value={mode}
                    checked={state.structureMode === mode}
                    onChange={() => setDialogState(setExportStructureMode(state, mode))}
                  />
                  {mode === "flatten" ? "Flat (all files in root)" : "Preserve collection structure"}
                </label>
              ))}
            </div>
          </div>

          {/* Watermark */}
          <div>
            <label htmlFor="export-watermark" className="mb-1 block text-sm font-medium text-foreground">
              Watermark text <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="export-watermark"
              type="text"
              value={state.watermarkText}
              onChange={(e) => setDialogState(setExportWatermarkText(state, e.target.value))}
              placeholder="Watermark to apply to all exported documents"
              className="input w-full"
            />
          </div>

          {/* Document selection */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                Documents{" "}
                <span className="font-normal text-muted-foreground">
                  ({state.selectedDocIds.length}/{allDocs.length} selected)
                </span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDialogState(selectAllDocs(state, allDocs))}
                  className="text-xs text-primary hover:text-primary/80"
                  disabled={allSelected}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setDialogState(deselectAllDocs(state))}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  disabled={state.selectedDocIds.length === 0}
                >
                  Deselect all
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
              {allDocs.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">No documents available.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {allDocs.map((doc) => {
                    const checked = state.selectedDocIds.includes(doc.id);
                    return (
                      <li key={doc.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setDialogState(toggleExportDoc(state, doc.id))}
                            className="shrink-0"
                          />
                          <span className="truncate text-sm text-foreground">{doc.name}</span>
                          <span className="ml-auto shrink-0 text-xs uppercase text-muted-foreground">{doc.format}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" disabled={state.selectedDocIds.length === 0 || loading} className="btn btn-primary">
              {loading ? "Exporting…" : `Export ${state.selectedDocIds.length} document${state.selectedDocIds.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Watermark preview dialog ---

function WatermarkPreviewDialog() {
  const pending = useAtomValue(watermarkPreviewPendingAtom);
  const setPending = useAtomSet(watermarkPreviewPendingAtom);
  const setPreview = useAtomSet(previewAtom);
  const [text, setText] = useState("");

  useEffect(() => {
    if (pending) setText(pending.watermarkText);
  }, [pending]);

  if (!pending) return null;

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setPreview({ documentId: pending.documentId, format: pending.format, name: pending.name, watermarkText: text });
    setPending(null);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wm-preview-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-card p-6 shadow-2xl ring-1 ring-border">
        <h2 id="wm-preview-dialog-title" className="mb-1 text-lg font-semibold text-foreground">
          Watermark preview
        </h2>
        <p className="mb-4 truncate text-sm text-muted-foreground">{pending.name}</p>
        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <div>
            <label htmlFor="wm-text" className="mb-1 block text-sm font-medium text-foreground">
              Watermark text
            </label>
            <input
              id="wm-text"
              type="text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. CONFIDENTIAL"
              className="input w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPending(null)} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={!text.trim()} className="btn btn-primary">
              Preview
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Document preview ---

function DocumentPreview() {
  const target = useAtomValue(previewAtom);
  const setPreview = useAtomSet(previewAtom);
  const dataResult = useAtomValue(previewDataAtom);

  if (!target) return null;

  const isLoading = Result.isWaiting(dataResult);
  const error = Result.isFailure(dataResult) ? "Failed to load preview." : null;
  const bytes = Result.isSuccess(dataResult) ? dataResult.value : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-dialog-title"
      className="fixed inset-0 z-50 flex flex-col bg-black/80"
      onClick={() => setPreview(null)}
    >
      <div className="flex h-14 shrink-0 items-center justify-between bg-foreground/95 px-4">
        <h2 id="preview-dialog-title" className="truncate text-sm font-medium text-background">
          {target.name}
        </h2>
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="ml-4 shrink-0 rounded p-1 text-background/60 hover:bg-background/10 hover:text-background"
          aria-label="Close preview"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 items-start justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {isLoading && <p className="mt-16 text-sm text-background/60">Loading…</p>}
        {error && <p className="mt-16 text-sm text-destructive-foreground">{error}</p>}
        {bytes && target.format === "pdf" && <PdfViewer bytes={bytes} />}
        {bytes && (target.format === "jpg" || target.format === "png") && <ImageViewer bytes={bytes} format={target.format} />}
      </div>
    </div>
  );
}

function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({ data: bytes });

    loadingTask.promise.then(async (pdf) => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = "";

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (cancelled) break;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "mb-2 shadow";
        containerRef.current.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
      }
    });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [bytes]);

  return <div ref={containerRef} className="flex flex-col items-center" />;
}

function ImageViewer({ bytes, format }: { bytes: Uint8Array; format: "jpg" | "png" }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
    const objectUrl = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: mimeType }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, format]);

  if (!url) return null;
  return <img src={url} alt="Document preview" className="max-w-full rounded shadow" />;
}
