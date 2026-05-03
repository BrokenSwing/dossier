import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { DocumentMeta } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Atom from "@effect-atom/atom/Atom";
import * as Result from "@effect-atom/atom/Result";
import { createRoute } from "@tanstack/react-router";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";
import { Route as authRoute } from "./_auth.js";

export const Route = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  component: DocumentsPage,
});

// --- State atom ---

type SortField = "name" | "createdAt";
type SortDirection = "asc" | "desc";

interface DocListState {
  readonly sortField: SortField;
  readonly sortDirection: SortDirection;
  readonly nameFilter: string;
  readonly cursors: ReadonlyArray<string | undefined>;
}

const initialDocListState: DocListState = {
  sortField: "createdAt",
  sortDirection: "desc",
  nameFilter: "",
  cursors: [undefined],
};

export const docListAtom = Atom.writable<DocListState, DocListState>(
  () => initialDocListState,
  (ctx, state) => ctx.setSelf(state),
).pipe(Atom.keepAlive);

// --- State transitions ---

const toggleSort = (state: DocListState, field: SortField): DocListState => ({
  ...state,
  sortField: field,
  sortDirection: state.sortField === field ? (state.sortDirection === "asc" ? "desc" : "asc") : "desc",
  cursors: [undefined],
});

const setNameFilter = (state: DocListState, nameFilter: string): DocListState => ({
  ...state,
  nameFilter,
  cursors: [undefined],
});

const appendCursor = (state: DocListState, cursor: string): DocListState => ({
  ...state,
  cursors: [...state.cursors, cursor],
});

// --- Page component ---

function DocumentsPage() {
  const session = useAtomValue(sessionAtom) as UnlockedSession;
  const state = useAtomValue(docListAtom);
  const setState = useAtomSet(docListAtom);

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
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
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

function SortButton({ label, active, direction, onClick }: { label: string; active: boolean; direction: SortDirection; onClick: () => void }) {
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
