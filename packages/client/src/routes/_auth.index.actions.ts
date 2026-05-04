import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import type { CollectionId, DocumentId, DocumentMeta } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Effect from "effect/Effect";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

// --- Rename dialog ---

export interface RenameDialogState {
  readonly documentId: DocumentId;
  readonly name: string;
}

export const renameDialogAtom = Atom.writable<RenameDialogState | null, RenameDialogState | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openRenameDialog = (doc: DocumentMeta): RenameDialogState => ({
  documentId: doc.id,
  name: doc.name,
});

export const setRenameName = (state: RenameDialogState, name: string): RenameDialogState => ({
  ...state,
  name,
});

// --- Edit document dialog (tags + collections) ---

export interface EditDocumentDialogState {
  readonly documentId: DocumentId;
  readonly tagInput: string;
  readonly selectedTags: ReadonlyArray<string>;
  readonly selectedCollectionIds: ReadonlyArray<CollectionId>;
}

export const editDocumentDialogAtom = Atom.writable<EditDocumentDialogState | null, EditDocumentDialogState | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const openEditDocumentDialog = (doc: DocumentMeta): EditDocumentDialogState => ({
  documentId: doc.id,
  tagInput: "",
  selectedTags: doc.tags,
  selectedCollectionIds: doc.collectionIds,
});

export const setEditTagInput = (state: EditDocumentDialogState, tagInput: string): EditDocumentDialogState => ({
  ...state,
  tagInput,
});

export const addEditTag = (state: EditDocumentDialogState, tag: string): EditDocumentDialogState =>
  state.selectedTags.includes(tag)
    ? { ...state, tagInput: "" }
    : { ...state, selectedTags: [...state.selectedTags, tag], tagInput: "" };

export const removeEditTag = (state: EditDocumentDialogState, tag: string): EditDocumentDialogState => ({
  ...state,
  selectedTags: state.selectedTags.filter((t) => t !== tag),
});

export const toggleEditCollection = (state: EditDocumentDialogState, id: CollectionId): EditDocumentDialogState => ({
  ...state,
  selectedCollectionIds: state.selectedCollectionIds.includes(id)
    ? state.selectedCollectionIds.filter((c) => c !== id)
    : [...state.selectedCollectionIds, id],
});

// --- Delete confirmation ---

export const confirmDeleteAtom = Atom.writable<DocumentMeta | null, DocumentMeta | null>(
  () => null,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

// --- RPC mutations ---

export const renameAtom = StorageRpc.runtime.fn<{ documentId: DocumentId; name: string }>()(
  ({ documentId, name }, get) => {
    const session = get(sessionAtom) as UnlockedSession;
    return Effect.gen(function* () {
      const client = yield* StorageRpc;
      yield* client("RenameDocument", { documentId, name }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
    }).pipe(Reactivity.mutation({ documents: [] }));
  },
);

export const deleteAtom = StorageRpc.runtime.fn<{ documentId: DocumentId }>()(({ documentId }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client("DeleteDocument", { documentId }, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
  }).pipe(Reactivity.mutation({ documents: [] }));
});

export const updateTagsAtom = StorageRpc.runtime.fn<{
  documentId: DocumentId;
  tagNames: ReadonlyArray<string>;
}>()(({ documentId, tagNames }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client(
      "UpdateDocumentTags",
      { documentId, tagNames: tagNames as string[] },
      { headers: { [STORAGE_SESSION_HEADER]: session.token } },
    );
  }).pipe(Reactivity.mutation({ documents: [] }));
});

export const updateCollectionsAtom = StorageRpc.runtime.fn<{
  documentId: DocumentId;
  collectionIds: ReadonlyArray<CollectionId>;
}>()(({ documentId, collectionIds }, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  return Effect.gen(function* () {
    const client = yield* StorageRpc;
    yield* client(
      "UpdateDocumentCollections",
      { documentId, collectionIds: collectionIds as CollectionId[] },
      { headers: { [STORAGE_SESSION_HEADER]: session.token } },
    );
  }).pipe(Reactivity.mutation({ documents: [] }));
});
