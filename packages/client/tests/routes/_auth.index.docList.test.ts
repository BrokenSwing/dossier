import { describe, expect, it } from "vitest";

import { appendCursor, setNameFilter, toggleSort, type DocListState } from "../../src/routes/_auth.index.docList.js";

const base: DocListState = {
  sortField: "createdAt",
  sortDirection: "desc",
  nameFilter: "",
  cursors: [undefined],
};

const withCursors: DocListState = {
  ...base,
  cursors: [undefined, "cursor-a", "cursor-b"],
};

describe("toggleSort", () => {
  it("activates a new field with descending direction", () => {
    const next = toggleSort(base, "name");
    expect(next.sortField).toBe("name");
    expect(next.sortDirection).toBe("desc");
  });

  it("flips direction when the same field is toggled", () => {
    const asc = toggleSort(base, "createdAt");
    expect(asc.sortDirection).toBe("asc");
    const desc = toggleSort(asc, "createdAt");
    expect(desc.sortDirection).toBe("desc");
  });

  it("resets direction to desc when switching fields even if current is asc", () => {
    const ascOnCreatedAt = { ...base, sortDirection: "asc" as const };
    const next = toggleSort(ascOnCreatedAt, "name");
    expect(next.sortField).toBe("name");
    expect(next.sortDirection).toBe("desc");
  });

  it("resets cursors to a single undefined entry", () => {
    const next = toggleSort(withCursors, "name");
    expect(next.cursors).toEqual([undefined]);
  });

  it("preserves other state fields", () => {
    const state: DocListState = { ...base, nameFilter: "invoice" };
    const next = toggleSort(state, "name");
    expect(next.nameFilter).toBe("invoice");
  });
});

describe("setNameFilter", () => {
  it("updates the nameFilter", () => {
    const next = setNameFilter(base, "report");
    expect(next.nameFilter).toBe("report");
  });

  it("resets cursors to a single undefined entry", () => {
    const next = setNameFilter(withCursors, "report");
    expect(next.cursors).toEqual([undefined]);
  });

  it("preserves sort state", () => {
    const state: DocListState = { ...base, sortField: "name", sortDirection: "asc" };
    const next = setNameFilter(state, "x");
    expect(next.sortField).toBe("name");
    expect(next.sortDirection).toBe("asc");
  });
});

describe("appendCursor", () => {
  it("appends a cursor to the list", () => {
    const next = appendCursor(base, "cursor-1");
    expect(next.cursors).toEqual([undefined, "cursor-1"]);
  });

  it("can append multiple cursors sequentially", () => {
    const s1 = appendCursor(base, "cursor-1");
    const s2 = appendCursor(s1, "cursor-2");
    expect(s2.cursors).toEqual([undefined, "cursor-1", "cursor-2"]);
  });

  it("preserves other state fields", () => {
    const state: DocListState = { ...base, nameFilter: "x" };
    const next = appendCursor(state, "c");
    expect(next.nameFilter).toBe("x");
  });
});
