import { describe, expect, it } from "vitest";

import {
  addTag,
  initialUploadFormState,
  removeTag,
  setFile,
  setTagInput,
  setUploadName,
  toggleCollection,
  type UploadFormState,
} from "../../src/routes/_auth.index.upload.js";

// CollectionId is just a branded string at runtime
const col = (id: string) => id as ReturnType<typeof import("@dossier/shared").CollectionId.make>;

const base: UploadFormState = initialUploadFormState;

function makeFile(name: string, type = "application/pdf"): File {
  return new File(["content"], name, { type });
}

describe("setFile", () => {
  it("sets the file", () => {
    const file = makeFile("report.pdf");
    const next = setFile(base, file);
    expect(next.file).toBe(file);
  });

  it("derives name from filename when name is empty", () => {
    const next = setFile(base, makeFile("invoice 2024.pdf"));
    expect(next.name).toBe("invoice 2024");
  });

  it("strips only the last extension", () => {
    const next = setFile(base, makeFile("archive.tar.gz"));
    expect(next.name).toBe("archive.tar");
  });

  it("does not overwrite an existing name", () => {
    const state: UploadFormState = { ...base, name: "My doc" };
    const next = setFile(state, makeFile("other.pdf"));
    expect(next.name).toBe("My doc");
  });

  it("preserves other form fields", () => {
    const state: UploadFormState = { ...base, tagInput: "draft", selectedTags: ["finance"] };
    const next = setFile(state, makeFile("x.pdf"));
    expect(next.tagInput).toBe("draft");
    expect(next.selectedTags).toEqual(["finance"]);
  });
});

describe("setUploadName", () => {
  it("updates the name", () => {
    const next = setUploadName(base, "My document");
    expect(next.name).toBe("My document");
  });
});

describe("setTagInput", () => {
  it("updates the tagInput", () => {
    const next = setTagInput(base, "fin");
    expect(next.tagInput).toBe("fin");
  });
});

describe("addTag", () => {
  it("adds a tag and clears the input", () => {
    const state: UploadFormState = { ...base, tagInput: "finance" };
    const next = addTag(state, "finance");
    expect(next.selectedTags).toEqual(["finance"]);
    expect(next.tagInput).toBe("");
  });

  it("does not add a duplicate tag", () => {
    const state: UploadFormState = { ...base, selectedTags: ["finance"], tagInput: "finance" };
    const next = addTag(state, "finance");
    expect(next.selectedTags).toEqual(["finance"]);
  });

  it("clears the input even when the tag is a duplicate", () => {
    const state: UploadFormState = { ...base, selectedTags: ["finance"], tagInput: "finance" };
    const next = addTag(state, "finance");
    expect(next.tagInput).toBe("");
  });

  it("appends to existing tags", () => {
    const state: UploadFormState = { ...base, selectedTags: ["finance"] };
    const next = addTag(state, "legal");
    expect(next.selectedTags).toEqual(["finance", "legal"]);
  });
});

describe("removeTag", () => {
  it("removes the specified tag", () => {
    const state: UploadFormState = { ...base, selectedTags: ["finance", "legal"] };
    const next = removeTag(state, "finance");
    expect(next.selectedTags).toEqual(["legal"]);
  });

  it("is a no-op when the tag is not present", () => {
    const state: UploadFormState = { ...base, selectedTags: ["finance"] };
    const next = removeTag(state, "unknown");
    expect(next.selectedTags).toEqual(["finance"]);
  });
});

describe("toggleCollection", () => {
  const id1 = col("col-1");
  const id2 = col("col-2");

  it("adds a collection when not selected", () => {
    const next = toggleCollection(base, id1);
    expect(next.selectedCollectionIds).toContain(id1);
  });

  it("removes a collection when already selected", () => {
    const state: UploadFormState = { ...base, selectedCollectionIds: [id1, id2] };
    const next = toggleCollection(state, id1);
    expect(next.selectedCollectionIds).not.toContain(id1);
    expect(next.selectedCollectionIds).toContain(id2);
  });

  it("preserves other form fields", () => {
    const state: UploadFormState = { ...base, name: "doc", selectedTags: ["x"] };
    const next = toggleCollection(state, id1);
    expect(next.name).toBe("doc");
    expect(next.selectedTags).toEqual(["x"]);
  });
});
