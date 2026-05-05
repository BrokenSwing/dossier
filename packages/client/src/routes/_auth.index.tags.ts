import type { TagId } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";

export const selectedTagsAtom = Atom.writable<ReadonlyArray<TagId>, ReadonlyArray<TagId>>(
  () => [],
  (ctx, tags) => ctx.setSelf(tags),
).pipe(Atom.keepAlive);

export const toggleTag = (state: ReadonlyArray<TagId>, tagId: TagId): ReadonlyArray<TagId> =>
  state.includes(tagId) ? state.filter((id) => id !== tagId) : [...state, tagId];

export const clearTags = (_state: ReadonlyArray<TagId>): ReadonlyArray<TagId> => [];
