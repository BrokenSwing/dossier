import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { Collection, CollectionId } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

// --- Tree building ---

export interface CollectionNode {
  readonly collection: Collection;
  readonly children: ReadonlyArray<CollectionNode>;
}

export function buildTree(collections: ReadonlyArray<Collection>): ReadonlyArray<CollectionNode> {
  const childrenMap = new Map<CollectionId | null, Collection[]>();
  for (const c of collections) {
    const parent = c.parentId;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(c);
  }
  function buildSubtree(parentId: CollectionId | null): CollectionNode[] {
    return (childrenMap.get(parentId) ?? []).map((c) => ({
      collection: c,
      children: buildSubtree(c.id),
    }));
  }
  return buildSubtree(null);
}

// --- Selected collection filter ---

export const selectedCollectionAtom = Atom.writable<CollectionId | null, CollectionId | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

// --- Create collection dialog ---

export interface CreateCollectionDialogState {
  readonly name: string;
  readonly parentId: CollectionId | null;
}

export const createCollectionDialogAtom = Atom.writable<CreateCollectionDialogState | null, CreateCollectionDialogState | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openCreateCollectionDialog = (parentId: CollectionId | null): CreateCollectionDialogState => ({
  name: "",
  parentId,
});

export const setCreateCollectionName = (state: CreateCollectionDialogState, name: string): CreateCollectionDialogState => ({ ...state, name });

// --- Edit collection dialog (rename + watermark) ---

export interface EditCollectionDialogState {
  readonly collectionId: CollectionId;
  readonly name: string;
  readonly watermarkText: string;
}

export const editCollectionDialogAtom = Atom.writable<EditCollectionDialogState | null, EditCollectionDialogState | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openEditCollectionDialog = (collection: Collection): EditCollectionDialogState => ({
  collectionId: collection.id,
  name: collection.name,
  watermarkText: collection.watermark?.text ?? "",
});

export const setEditCollectionName = (state: EditCollectionDialogState, name: string): EditCollectionDialogState => ({ ...state, name });

export const setEditWatermarkText = (state: EditCollectionDialogState, watermarkText: string): EditCollectionDialogState => ({
  ...state,
  watermarkText,
});

// --- Delete confirm ---

export const confirmDeleteCollectionAtom = Atom.writable<Collection | null, Collection | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

// --- Move collection dialog ---

export interface MoveCollectionDialogState {
  readonly collectionId: CollectionId;
  readonly collectionName: string;
  readonly newParentId: CollectionId | null;
}

export const moveCollectionDialogAtom = Atom.writable<MoveCollectionDialogState | null, MoveCollectionDialogState | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openMoveCollectionDialog = (collection: Collection): MoveCollectionDialogState => ({
  collectionId: collection.id,
  collectionName: collection.name,
  newParentId: collection.parentId,
});

export const setMoveCollectionParent = (state: MoveCollectionDialogState, newParentId: CollectionId | null): MoveCollectionDialogState => ({
  ...state,
  newParentId,
});

// --- RPC mutations ---

export const createCollectionAtom = StorageRpc.runtime.fn<{
  name: string;
  parentId: CollectionId | null;
}>()(({ name, parentId }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client("CreateCollection", { name, parentId }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
  }).pipe(Reactivity.mutation({ collections: [] }));
});

export const updateCollectionAtom = StorageRpc.runtime.fn<{
  collectionId: CollectionId;
  name: string;
  watermarkText: string;
}>()(({ collectionId, name, watermarkText }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  const watermark = watermarkText.trim() ? { text: watermarkText.trim() } : null;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client("UpdateCollection", { collectionId, name, watermark }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
  }).pipe(Reactivity.mutation({ collections: [] }));
});

export const deleteCollectionAtom = StorageRpc.runtime.fn<{
  collectionId: CollectionId;
  recursive: boolean;
}>()(({ collectionId, recursive }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client("DeleteCollection", { collectionId, recursive }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
  }).pipe(Reactivity.mutation({ collections: [], documents: [] }));
});

export const moveCollectionAtom = StorageRpc.runtime.fn<{
  collectionId: CollectionId;
  newParentId: CollectionId | null;
}>()(({ collectionId, newParentId }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client("MoveCollection", { collectionId, newParentId }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
  }).pipe(Reactivity.mutation({ collections: [] }));
});
