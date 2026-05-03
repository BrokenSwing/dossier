import type { CollectionId } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Reactivity from "@effect/experimental/Reactivity";
import { FetchHttpClient } from "@effect/platform";
import * as Effect from "effect/Effect";

import { bytesToBase64Url } from "../lib/crypto.js";
import { StorageRpc, uploadDocument, UploadError } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

export interface UploadFormState {
  readonly file: File | null;
  readonly name: string;
  readonly tagInput: string;
  readonly selectedTags: ReadonlyArray<string>;
  readonly selectedCollectionIds: ReadonlyArray<CollectionId>;
}

export const initialUploadFormState: UploadFormState = {
  file: null,
  name: "",
  tagInput: "",
  selectedTags: [],
  selectedCollectionIds: [],
};

export const uploadOpenAtom = Atom.writable<boolean, boolean>(
  () => false,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const uploadFormAtom = Atom.writable<UploadFormState, UploadFormState>(
  () => initialUploadFormState,
  (ctx, v) => ctx.setSelf(v),
).pipe(Atom.keepAlive);

export const setFile = (state: UploadFormState, file: File): UploadFormState => ({
  ...state,
  file,
  name: state.name || file.name.replace(/\.[^.]+$/, ""),
});

export const setUploadName = (state: UploadFormState, name: string): UploadFormState => ({ ...state, name });

export const setTagInput = (state: UploadFormState, tagInput: string): UploadFormState => ({ ...state, tagInput });

export const addTag = (state: UploadFormState, tag: string): UploadFormState =>
  state.selectedTags.includes(tag)
    ? { ...state, tagInput: "" }
    : { ...state, selectedTags: [...state.selectedTags, tag], tagInput: "" };

export const removeTag = (state: UploadFormState, tag: string): UploadFormState => ({
  ...state,
  selectedTags: state.selectedTags.filter((t) => t !== tag),
});

export const toggleCollection = (state: UploadFormState, id: CollectionId): UploadFormState => ({
  ...state,
  selectedCollectionIds: state.selectedCollectionIds.includes(id)
    ? state.selectedCollectionIds.filter((c) => c !== id)
    : [...state.selectedCollectionIds, id],
});

function getFormat(file: File): "pdf" | "jpg" | "png" {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/jpeg") return "jpg";
  return "png";
}

export const uploadAtom = StorageRpc.runtime.fn<void>()((_arg, get) => {
  const session = get(sessionAtom) as UnlockedSession;
  const form = get(uploadFormAtom);
  if (!form.file) return Effect.fail(new UploadError({ message: "No file selected." }));
  const file = form.file;
  return Effect.gen(function* () {
    const bytes = new Uint8Array(
      yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (e) => new UploadError({ message: String(e) }),
      }),
    );
    return yield* uploadDocument({
      file: bytes,
      name: form.name || file.name,
      format: getFormat(file),
      dekBase64Url: bytesToBase64Url(session.dek),
      sessionToken: session.token,
      ...(form.selectedTags.length > 0 ? { tagNames: form.selectedTags } : {}),
      ...(form.selectedCollectionIds.length > 0 ? { collectionIds: form.selectedCollectionIds as CollectionId[] } : {}),
    });
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Reactivity.mutation({ documents: [] }),
  );
});
