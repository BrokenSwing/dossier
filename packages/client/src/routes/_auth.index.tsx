import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { Collection, DocumentMeta, Tag } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute } from "@tanstack/react-router";
import * as pdfjsLib from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";
import { Route as authRoute } from "./_auth.js";
import { previewAtom, previewDataAtom, type PreviewTarget } from "./_auth.index.preview.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
import {
  appendCursor,
  docListAtom,
  setNameFilter,
  toggleSort,
  type DocListState,
  type SortDirection,
  type SortField,
} from "./_auth.index.docList.js";
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
  type UploadFormState,
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Documents</h1>
        <input
          type="search"
          placeholder="Search by name…"
          value={state.nameFilter}
          onChange={(e) => setState(setNameFilter(state, e.target.value))}
          className="input w-full max-w-sm"
        />
        <button type="button" onClick={() => setUploadOpen(true)} className="ml-auto shrink-0 btn btn-primary">
          Upload
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="pb-2 pr-4 text-xs font-medium tracking-wide text-gray-500 uppercase">
              <SortButton
                label="Name"
                active={state.sortField === "name"}
                direction={state.sortDirection}
                onClick={() => setState(toggleSort(state, "name"))}
              />
            </th>
            <th className="pb-2 pr-4 text-xs font-medium tracking-wide text-gray-500 uppercase">Format</th>
            <th className="pb-2 pr-4 text-xs font-medium tracking-wide text-gray-500 uppercase">Tags</th>
            <th className="pb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">
              <SortButton
                label="Date"
                active={state.sortField === "createdAt"}
                direction={state.sortDirection}
                onClick={() => setState(toggleSort(state, "createdAt"))}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {state.cursors.map((cursor, i) => (
            <DocumentPageRows
              key={cursor ?? "__first__"}
              sortField={state.sortField}
              sortDirection={state.sortDirection}
              nameFilter={state.nameFilter || undefined}
              cursor={cursor}
              token={session.token}
              isLastPage={i === state.cursors.length - 1}
              onLoadMore={(nextCursor) => setState(appendCursor(state, nextCursor))}
            />
          ))}
        </tbody>
      </table>

      <UploadDialog session={session} />
      <DocumentPreview />
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
    ? availableTags
        .filter((t) => t.name.toLowerCase().includes(form.tagInput.toLowerCase()) && !form.selectedTags.includes(t.name))
        .slice(0, 5)
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
    <div role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 id="upload-dialog-title" className="mb-4 text-lg font-semibold text-gray-900">Upload document</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="upload-file" className="mb-1 block text-sm font-medium text-gray-700">File</label>
            <input
              id="upload-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setForm(setFile(form, f));
              }}
              className="block w-full text-sm text-gray-500 file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </div>

          <div>
            <label htmlFor="upload-name" className="mb-1 block text-sm font-medium text-gray-700">Name</label>
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
            <label htmlFor="upload-tag-input" className="mb-1 block text-sm font-medium text-gray-700">Tags</label>
            {form.selectedTags.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1">
                {form.selectedTags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    {tag}
                    <button
                      type="button"
                      onClick={() => setForm(removeTag(form, tag))}
                      className="text-blue-500 hover:text-blue-700"
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
                <ul className="absolute z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-sm">
                  {filteredSuggestions.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm(addTag(form, t.name));
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
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
              <label className="mb-1 block text-sm font-medium text-gray-700">Collections</label>
              <div className="max-h-32 overflow-y-auto rounded border border-gray-200 p-2">
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

          {error && <p className="text-sm text-red-600">{error}</p>}

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
  readonly cursor: string | undefined;
  readonly token: string;
  readonly isLastPage: boolean;
  readonly onLoadMore: (nextCursor: string) => void;
}

function DocumentPageRows({ sortField, sortDirection, nameFilter, cursor, token, isLastPage, onLoadMore }: PageRowsProps) {
  const queryAtom = StorageRpc.query(
    "ListDocuments",
    { sortField, sortDirection, nameFilter, cursor, limit: 20 },
    { headers: { [STORAGE_SESSION_HEADER]: token }, reactivityKeys: { documents: [] } },
  );

  const result = useAtomValue(queryAtom);

  if (!Result.isSuccess(result)) {
    if (!isLastPage) return null;
    if (Result.isFailure(result)) {
      return (
        <tr>
          <td colSpan={4} className="py-8 text-center text-sm text-red-500">
            Failed to load documents.
          </td>
        </tr>
      );
    }
    return (
      <tr>
        <td colSpan={4} className="py-8 text-center text-sm text-gray-400">
          Loading…
        </td>
      </tr>
    );
  }

  const { documents, nextCursor } = result.value;

  if (documents.length === 0 && !cursor) {
    return (
      <tr>
        <td colSpan={4} className="py-8 text-center text-sm text-gray-400">
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
          <td colSpan={4} className="pt-4 pb-2 text-center">
            <button type="button" onClick={() => onLoadMore(nextCursor)} className="text-sm text-blue-600 hover:text-blue-500">
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
  const target: PreviewTarget = { documentId: doc.id, format: doc.format, name: doc.name };

  return (
    <tr
      className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
      onClick={() => setPreview(target)}
    >
      <td className="py-2 pr-4 font-medium text-gray-900">{doc.name}</td>
      <td className="py-2 pr-4 text-xs uppercase text-gray-500">{doc.format}</td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap gap-1">
          {doc.tags.map((tag) => (
            <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="py-2 whitespace-nowrap text-gray-500">{formatDate(doc.createdAt)}</td>
    </tr>
  );
}

// --- UI helpers ---

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 ${active ? "text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
    >
      {label}
      {active && <span className="text-gray-400">{direction === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
      <div className="flex h-14 shrink-0 items-center justify-between bg-gray-900 px-4">
        <h2 id="preview-dialog-title" className="truncate text-sm font-medium text-white">
          {target.name}
        </h2>
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="ml-4 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
          aria-label="Close preview"
        >
          ✕
        </button>
      </div>

      <div
        className="flex flex-1 items-start justify-center overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading && (
          <p className="mt-16 text-sm text-gray-400">Loading…</p>
        )}
        {error && (
          <p className="mt-16 text-sm text-red-400">{error}</p>
        )}
        {bytes && target.format === "pdf" && <PdfViewer bytes={bytes} />}
        {bytes && (target.format === "jpg" || target.format === "png") && (
          <ImageViewer bytes={bytes} format={target.format} />
        )}
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
