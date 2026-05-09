import type { CollectionId, DocumentId, DocumentMeta } from "@dossier/shared";
import { describe, expect, it } from "vitest";

import {
  addEditTag,
  openEditDocumentDialog,
  openRenameDialog,
  removeEditTag,
  setEditTagInput,
  setRenameName,
  toggleEditCollection,
  type EditDocumentDialogState,
  type RenameDialogState,
} from "../../src/routes/_auth.index.actions.js";

const col = (id: string) => id as CollectionId;

const baseDoc: DocumentMeta = {
  id: "doc-1" as DocumentId,
  name: "Invoice 2024.pdf",
  format: "pdf",
  tags: ["finance", "2024"],
  collectionIds: [col("col-a")],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  encryptedSize: 1024,
};

describe("openRenameDialog", () => {
  it("creates state with doc id and current name", () => {
    const state = openRenameDialog(baseDoc);
    expect(state.documentId).toBe(baseDoc.id);
    expect(state.name).toBe(baseDoc.name);
  });
});

describe("setRenameName", () => {
  it("updates the name", () => {
    const state: RenameDialogState = { documentId: baseDoc.id, name: "Old" };
    const next = setRenameName(state, "New");
    expect(next.name).toBe("New");
    expect(next.documentId).toBe(baseDoc.id);
  });

  it("preserves documentId", () => {
    const state: RenameDialogState = { documentId: baseDoc.id, name: "X" };
    const next = setRenameName(state, "Y");
    expect(next.documentId).toBe(state.documentId);
  });
});

describe("openEditDocumentDialog", () => {
  it("creates state with doc's existing tags", () => {
    const state = openEditDocumentDialog(baseDoc);
    expect(state.selectedTags).toEqual(["finance", "2024"]);
  });

  it("creates state with doc's existing collection ids", () => {
    const state = openEditDocumentDialog(baseDoc);
    expect(state.selectedCollectionIds).toEqual([col("col-a")]);
  });

  it("starts with empty tag input", () => {
    const state = openEditDocumentDialog(baseDoc);
    expect(state.tagInput).toBe("");
  });

  it("sets the documentId", () => {
    const state = openEditDocumentDialog(baseDoc);
    expect(state.documentId).toBe(baseDoc.id);
  });
});

describe("setEditTagInput", () => {
  it("updates tagInput", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = setEditTagInput(state, "leg");
    expect(next.tagInput).toBe("leg");
  });

  it("preserves other fields", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = setEditTagInput(state, "x");
    expect(next.selectedTags).toEqual(state.selectedTags);
    expect(next.selectedCollectionIds).toEqual(state.selectedCollectionIds);
  });
});

describe("addEditTag", () => {
  it("adds a new tag and clears input", () => {
    const state: EditDocumentDialogState = { ...openEditDocumentDialog(baseDoc), tagInput: "legal" };
    const next = addEditTag(state, "legal");
    expect(next.selectedTags).toContain("legal");
    expect(next.tagInput).toBe("");
  });

  it("does not add a duplicate tag", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = addEditTag(state, "finance");
    expect(next.selectedTags.filter((t) => t === "finance")).toHaveLength(1);
  });

  it("clears input even when tag is a duplicate", () => {
    const state: EditDocumentDialogState = { ...openEditDocumentDialog(baseDoc), tagInput: "finance" };
    const next = addEditTag(state, "finance");
    expect(next.tagInput).toBe("");
  });

  it("appends to existing tags", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = addEditTag(state, "legal");
    expect(next.selectedTags).toEqual(["finance", "2024", "legal"]);
  });
});

describe("removeEditTag", () => {
  it("removes the specified tag", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = removeEditTag(state, "finance");
    expect(next.selectedTags).toEqual(["2024"]);
  });

  it("is a no-op when tag is not present", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = removeEditTag(state, "unknown");
    expect(next.selectedTags).toEqual(["finance", "2024"]);
  });
});

describe("toggleEditCollection", () => {
  it("adds a collection when not selected", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = toggleEditCollection(state, col("col-b"));
    expect(next.selectedCollectionIds).toContain(col("col-b"));
    expect(next.selectedCollectionIds).toContain(col("col-a"));
  });

  it("removes a collection when already selected", () => {
    const state = openEditDocumentDialog(baseDoc);
    const next = toggleEditCollection(state, col("col-a"));
    expect(next.selectedCollectionIds).not.toContain(col("col-a"));
  });

  it("preserves other fields", () => {
    const state: EditDocumentDialogState = { ...openEditDocumentDialog(baseDoc), tagInput: "draft" };
    const next = toggleEditCollection(state, col("col-b"));
    expect(next.tagInput).toBe("draft");
    expect(next.selectedTags).toEqual(state.selectedTags);
  });
});
