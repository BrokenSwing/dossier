import type { TagId } from "@dossier/shared";
import { describe, expect, it } from "vitest";

import { clearTags, toggleTag } from "../../src/routes/_auth.index.tags.js";

const id = (s: string) => s as TagId;

describe("toggleTag", () => {
  it("adds a tag that is not yet selected", () => {
    const result = toggleTag([], id("t1"));
    expect(result).toEqual([id("t1")]);
  });

  it("removes a tag that is already selected", () => {
    const result = toggleTag([id("t1"), id("t2")], id("t1"));
    expect(result).toEqual([id("t2")]);
  });

  it("does not mutate the original array", () => {
    const original = [id("t1")];
    toggleTag(original, id("t2"));
    expect(original).toEqual([id("t1")]);
  });

  it("handles toggling the only selected tag off", () => {
    const result = toggleTag([id("t1")], id("t1"));
    expect(result).toEqual([]);
  });

  it("adds a second tag to existing selection", () => {
    const result = toggleTag([id("t1")], id("t2"));
    expect(result).toEqual([id("t1"), id("t2")]);
  });

  it("toggles a tag not at the start or end", () => {
    const result = toggleTag([id("t1"), id("t2"), id("t3")], id("t2"));
    expect(result).toEqual([id("t1"), id("t3")]);
  });
});

describe("clearTags", () => {
  it("returns empty array for non-empty selection", () => {
    expect(clearTags([id("t1"), id("t2")])).toEqual([]);
  });

  it("returns empty array when already empty", () => {
    expect(clearTags([])).toEqual([]);
  });
});
