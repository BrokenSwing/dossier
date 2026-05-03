import * as Atom from "@effect-atom/atom/Atom";

export type SortField = "name" | "createdAt";
export type SortDirection = "asc" | "desc";

export interface DocListState {
  readonly sortField: SortField;
  readonly sortDirection: SortDirection;
  readonly nameFilter: string;
  readonly cursors: ReadonlyArray<string | undefined>;
}

const initialState: DocListState = {
  sortField: "createdAt",
  sortDirection: "desc",
  nameFilter: "",
  cursors: [undefined],
};

export const docListAtom = Atom.writable<DocListState, DocListState>(
  () => initialState,
  (ctx, state) => ctx.setSelf(state),
).pipe(Atom.keepAlive);

export const toggleSort = (state: DocListState, field: SortField): DocListState => ({
  ...state,
  sortField: field,
  sortDirection: state.sortField === field ? (state.sortDirection === "asc" ? "desc" : "asc") : "desc",
  cursors: [undefined],
});

export const setNameFilter = (state: DocListState, nameFilter: string): DocListState => ({
  ...state,
  nameFilter,
  cursors: [undefined],
});

export const appendCursor = (state: DocListState, cursor: string): DocListState => ({
  ...state,
  cursors: [...state.cursors, cursor],
});
