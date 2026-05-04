import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { Collection } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, SessionState, type UnlockedSession } from "../session.js";
import { Route as rootRoute } from "./__root.js";
import {
  buildTree,
  confirmDeleteCollectionAtom,
  createCollectionDialogAtom,
  editCollectionDialogAtom,
  moveCollectionDialogAtom,
  openCreateCollectionDialog,
  openEditCollectionDialog,
  openMoveCollectionDialog,
  selectedCollectionAtom,
  type CollectionNode,
} from "./_auth.index.collections.js";
import { logoutAtom } from "./_auth.logout.js";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  id: "_auth",
  beforeLoad: ({ context }) => {
    const session = context.registry.get(sessionAtom);
    if (session._tag !== "Unlocked") {
      throw redirect({ to: "/login" });
    }
  },
  component: AppShell,
});

// --- Shell ---

function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  const session = useAtomValue(sessionAtom);
  const navigate = useNavigate();
  const logout = useAtomSet(logoutAtom, { mode: "promiseExit" });
  const setSession = useAtomSet(sessionAtom);

  async function handleLogout() {
    await logout();
    setSession(SessionState.LoggedOut());
    void navigate({ to: "/login" });
  }

  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-base font-semibold text-gray-900">Dossier</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {session._tag === "Unlocked" && <CollectionTree session={session} />}
        <SidebarSection title="Tags">
          <p className="px-2 py-1 text-xs text-gray-400">No tags yet.</p>
        </SidebarSection>
      </nav>
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-gray-700">
            {session._tag === "Unlocked" ? session.username : ""}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between px-2 py-1">
        <h2 className="text-xs font-medium tracking-wide text-gray-400 uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CollectionTree({ session }: { session: UnlockedSession }) {
  const collectionsQueryAtom = StorageRpc.query("ListCollections", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
    reactivityKeys: { collections: [] },
  });
  const result = useAtomValue(collectionsQueryAtom);
  const selectedCollection = useAtomValue(selectedCollectionAtom);
  const setSelectedCollection = useAtomSet(selectedCollectionAtom);
  const setCreateDialog = useAtomSet(createCollectionDialogAtom);

  const collections: ReadonlyArray<Collection> = Result.isSuccess(result) ? result.value : [];
  const roots = buildTree(collections);

  return (
    <SidebarSection
      title="Collections"
      action={
        <button
          type="button"
          aria-label="New collection"
          onClick={() => setCreateDialog(openCreateCollectionDialog(null))}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          +
        </button>
      }
    >
      <ul>
        <li>
          <button
            type="button"
            onClick={() => setSelectedCollection(null)}
            className={`w-full rounded px-2 py-1 text-left text-xs ${selectedCollection === null ? "font-medium text-blue-700 bg-blue-50" : "text-gray-600 hover:bg-gray-100"}`}
          >
            All documents
          </button>
        </li>
        {roots.map((node) => (
          <CollectionTreeItem key={node.collection.id} node={node} depth={0} />
        ))}
      </ul>
    </SidebarSection>
  );
}

function CollectionTreeItem({ node, depth }: { node: CollectionNode; depth: number }) {
  const selected = useAtomValue(selectedCollectionAtom);
  const setSelected = useAtomSet(selectedCollectionAtom);
  const setCreateDialog = useAtomSet(createCollectionDialogAtom);
  const setEditDialog = useAtomSet(editCollectionDialogAtom);
  const setDeleteDialog = useAtomSet(confirmDeleteCollectionAtom);
  const setMoveDialog = useAtomSet(moveCollectionDialogAtom);

  const { collection, children } = node;
  const isSelected = selected === collection.id;

  return (
    <li>
      <div
        className={`group flex items-center gap-0.5 rounded ${isSelected ? "bg-blue-50" : "hover:bg-gray-100"}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => setSelected(collection.id)}
          className={`flex-1 truncate py-1 text-left text-xs ${isSelected ? "font-medium text-blue-700" : "text-gray-700"}`}
        >
          {collection.name}
        </button>
        <button
          type="button"
          aria-label={`Create child collection in ${collection.name}`}
          onClick={() => setCreateDialog(openCreateCollectionDialog(collection.id))}
          className="shrink-0 rounded px-0.5 text-gray-400 hover:text-gray-700"
        >
          +
        </button>
        <button
          type="button"
          aria-label={`Edit collection ${collection.name}`}
          onClick={() => setEditDialog(openEditCollectionDialog(collection))}
          className="shrink-0 rounded px-0.5 text-gray-400 hover:text-gray-700"
        >
          ✎
        </button>
        <button
          type="button"
          aria-label={`Move collection ${collection.name}`}
          onClick={() => setMoveDialog(openMoveCollectionDialog(collection))}
          className="shrink-0 rounded px-0.5 text-gray-400 hover:text-gray-700"
        >
          ↕
        </button>
        <button
          type="button"
          aria-label={`Delete collection ${collection.name}`}
          onClick={() => setDeleteDialog(collection)}
          className="shrink-0 rounded px-0.5 text-red-400 hover:text-red-700"
        >
          ×
        </button>
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <CollectionTreeItem key={child.collection.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
