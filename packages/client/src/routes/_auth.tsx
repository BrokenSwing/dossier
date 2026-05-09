import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { Collection, Tag, TagId } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import * as Result from "@effect-atom/atom/Result";
import { createRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";

import { StorageRpc } from "../lib/rpc.js";
import { isTokenExpired, sessionAtom, SessionState, type UnlockedSession } from "../session.js";
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
import { selectedTagsAtom, toggleTag } from "./_auth.index.tags.js";
import { initialUploadFormState, setFile, uploadFormAtom, uploadOpenAtom } from "./_auth.index.upload.js";
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

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const setUploadOpen = useAtomSet(uploadOpenAtom);
  const setUploadForm = useAtomSet(uploadFormAtom);
  const session = useAtomValue(sessionAtom);
  const setSession = useAtomSet(sessionAtom);
  const navigate = useNavigate();

  useEffect(() => {
    function checkExpiry() {
      if (session._tag === "Unlocked" && isTokenExpired(session.token)) {
        setSession(SessionState.LoggedOut());
        void navigate({ to: "/login" });
      }
    }
    document.addEventListener("visibilitychange", checkExpiry);
    return () => document.removeEventListener("visibilitychange", checkExpiry);
  }, [session, setSession, navigate]);

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setUploadForm(setFile(initialUploadFormState, file));
    setUploadOpen(true);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="text-sm font-semibold text-foreground">Dossier</span>
        </div>
        <main className="relative flex flex-1 flex-col overflow-y-auto" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <Outlet />
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl text-primary">↑</div>
              <p className="text-sm font-medium text-primary">Drop to upload the document</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useAtomValue(sessionAtom);
  const navigate = useNavigate();
  const logout = useAtomSet(logoutAtom, { mode: "promiseExit" });
  const setSession = useAtomSet(sessionAtom);
  const routerState = useRouterState();
  const isSettings = routerState.location.pathname === "/settings";

  async function handleLogout() {
    await logout();
    setSession(SessionState.LoggedOut());
    void navigate({ to: "/login" });
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:static md:w-56 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      {/* Logo */}
      <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">D</div>
        <span className="text-sm font-semibold text-sidebar-foreground">Dossier</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {session._tag === "Unlocked" && (
          <>
            <CollectionTree session={session} />
            <TagFilter session={session} />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
            {session._tag === "Unlocked" ? session.username.charAt(0).toUpperCase() : "?"}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground">
            {session._tag === "Unlocked" ? session.username : ""}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              to="/settings"
              className={`rounded p-1.5 text-xs transition-colors ${isSettings ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
              title="Settings"
            >
              ⚙
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded p-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title="Sign out"
            >
              ↩
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-2 py-0.5">
        <h2 className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">{title}</h2>
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
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          +
        </button>
      }
    >
      <ul className="flex flex-col gap-0.5">
        <li>
          <button
            type="button"
            onClick={() => setSelectedCollection(null)}
            className={`w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
              selectedCollection === null ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            }`}
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
        className={`group flex items-center rounded-md transition-colors ${isSelected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}
        style={{ paddingLeft: `${depth * 10 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => setSelected(collection.id)}
          className={`flex-1 truncate py-1.5 pr-1 text-left text-xs font-medium transition-colors ${
            isSelected ? "text-sidebar-accent-foreground" : "text-sidebar-foreground"
          }`}
        >
          {collection.name}
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Create child collection in ${collection.name}`}
            onClick={() => setCreateDialog(openCreateCollectionDialog(collection.id))}
            className="rounded p-1 text-[10px] text-muted-foreground hover:text-sidebar-accent-foreground"
          >
            +
          </button>
          <button
            type="button"
            aria-label={`Edit collection ${collection.name}`}
            onClick={() => setEditDialog(openEditCollectionDialog(collection))}
            className="rounded p-1 text-[10px] text-muted-foreground hover:text-sidebar-accent-foreground"
          >
            ✎
          </button>
          <button
            type="button"
            aria-label={`Move collection ${collection.name}`}
            onClick={() => setMoveDialog(openMoveCollectionDialog(collection))}
            className="rounded p-1 text-[10px] text-muted-foreground hover:text-sidebar-accent-foreground"
          >
            ↕
          </button>
          <button
            type="button"
            aria-label={`Delete collection ${collection.name}`}
            onClick={() => setDeleteDialog(collection)}
            className="rounded p-1 text-[10px] text-muted-foreground hover:text-destructive"
          >
            ×
          </button>
        </div>
      </div>
      {children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {children.map((child) => (
            <CollectionTreeItem key={child.collection.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TagFilter({ session }: { session: UnlockedSession }) {
  const tagsQueryAtom = StorageRpc.query("ListTags", undefined, {
    headers: { [STORAGE_SESSION_HEADER]: session.token },
    reactivityKeys: { documents: [] },
  });
  const result = useAtomValue(tagsQueryAtom);
  const selectedTags = useAtomValue(selectedTagsAtom);
  const setSelectedTags = useAtomSet(selectedTagsAtom);

  const tags: ReadonlyArray<Tag> = Result.isSuccess(result) ? result.value : [];

  return (
    <SidebarSection title="Tags">
      {tags.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">No tags yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {tags.map((tag) => {
            const active = selectedTags.includes(tag.id as TagId);
            return (
              <li key={tag.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTags(toggleTag(selectedTags, tag.id as TagId))}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                    active ? "bg-primary/15 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                  <span className={`ml-1 shrink-0 tabular-nums text-[10px] ${active ? "text-primary/70" : "text-muted-foreground"}`}>
                    {tag.documentCount}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SidebarSection>
  );
}
