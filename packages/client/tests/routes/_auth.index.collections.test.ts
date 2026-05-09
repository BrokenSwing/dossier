import type { Collection, CollectionId } from "@dossier/shared";
import { describe, expect, it } from "vitest";

import {
  buildTree,
  openCreateCollectionDialog,
  openEditCollectionDialog,
  openMoveCollectionDialog,
  setCreateCollectionName,
  setEditCollectionName,
  setEditWatermarkText,
  setMoveCollectionParent,
  type CreateCollectionDialogState,
  type EditCollectionDialogState,
  type MoveCollectionDialogState,
} from "../../src/routes/_auth.index.collections.js";

const col = (id: string) => id as CollectionId;

function makeCollection(id: string, parentId: string | null = null, watermarkText: string | null = null): Collection {
  return {
    id: col(id),
    name: `Col ${id}`,
    parentId: parentId ? col(parentId) : null,
    watermark: watermarkText ? { text: watermarkText } : null,
    createdAt: "2024-01-01T00:00:00Z",
  } as unknown as Collection;
}

describe("buildTree", () => {
  it("returns empty array for no collections", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("returns root-level collections when none have a parent", () => {
    const cols = [makeCollection("a"), makeCollection("b")];
    const tree = buildTree(cols);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.collection.id)).toEqual([col("a"), col("b")]);
  });

  it("nests children under their parent", () => {
    const cols = [makeCollection("a"), makeCollection("b", "a")];
    const tree = buildTree(cols);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.collection.id).toBe(col("b"));
  });

  it("handles multiple levels of nesting", () => {
    const cols = [makeCollection("a"), makeCollection("b", "a"), makeCollection("c", "b")];
    const tree = buildTree(cols);
    expect(tree[0]!.children[0]!.children[0]!.collection.id).toBe(col("c"));
  });

  it("handles multiple roots each with children", () => {
    const cols = [makeCollection("a"), makeCollection("b"), makeCollection("c", "a"), makeCollection("d", "b")];
    const tree = buildTree(cols);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children[0]!.collection.id).toBe(col("c"));
    expect(tree[1]!.children[0]!.collection.id).toBe(col("d"));
  });

  it("produces empty children array for leaf nodes", () => {
    const tree = buildTree([makeCollection("a")]);
    expect(tree[0]!.children).toEqual([]);
  });
});

describe("openCreateCollectionDialog", () => {
  it("creates state with null parentId for root", () => {
    const state = openCreateCollectionDialog(null);
    expect(state.parentId).toBeNull();
    expect(state.name).toBe("");
  });

  it("creates state with the given parentId", () => {
    const state = openCreateCollectionDialog(col("x"));
    expect(state.parentId).toBe(col("x"));
  });
});

describe("setCreateCollectionName", () => {
  it("updates the name", () => {
    const state: CreateCollectionDialogState = { name: "", parentId: null };
    const next = setCreateCollectionName(state, "Finance");
    expect(next.name).toBe("Finance");
  });

  it("preserves parentId", () => {
    const state: CreateCollectionDialogState = { name: "", parentId: col("p") };
    const next = setCreateCollectionName(state, "X");
    expect(next.parentId).toBe(col("p"));
  });
});

describe("openEditCollectionDialog", () => {
  it("pre-fills name from collection", () => {
    const state = openEditCollectionDialog(makeCollection("a"));
    expect(state.name).toBe("Col a");
  });

  it("pre-fills watermarkText from collection watermark", () => {
    const state = openEditCollectionDialog(makeCollection("a", null, "CONFIDENTIAL"));
    expect(state.watermarkText).toBe("CONFIDENTIAL");
  });

  it("uses empty string when collection has no watermark", () => {
    const state = openEditCollectionDialog(makeCollection("a"));
    expect(state.watermarkText).toBe("");
  });

  it("sets the collectionId", () => {
    const state = openEditCollectionDialog(makeCollection("a"));
    expect(state.collectionId).toBe(col("a"));
  });
});

describe("setEditCollectionName", () => {
  it("updates the name", () => {
    const state: EditCollectionDialogState = { collectionId: col("a"), name: "Old", watermarkText: "" };
    const next = setEditCollectionName(state, "New");
    expect(next.name).toBe("New");
  });

  it("preserves other fields", () => {
    const state: EditCollectionDialogState = { collectionId: col("a"), name: "X", watermarkText: "draft" };
    const next = setEditCollectionName(state, "Y");
    expect(next.watermarkText).toBe("draft");
    expect(next.collectionId).toBe(col("a"));
  });
});

describe("setEditWatermarkText", () => {
  it("updates the watermarkText", () => {
    const state: EditCollectionDialogState = { collectionId: col("a"), name: "X", watermarkText: "" };
    const next = setEditWatermarkText(state, "DRAFT");
    expect(next.watermarkText).toBe("DRAFT");
  });

  it("preserves other fields", () => {
    const state: EditCollectionDialogState = { collectionId: col("a"), name: "Docs", watermarkText: "" };
    const next = setEditWatermarkText(state, "PRIVATE");
    expect(next.name).toBe("Docs");
  });
});

describe("openMoveCollectionDialog", () => {
  it("sets collectionId and collectionName", () => {
    const state = openMoveCollectionDialog(makeCollection("a"));
    expect(state.collectionId).toBe(col("a"));
    expect(state.collectionName).toBe("Col a");
  });

  it("uses current parentId as newParentId", () => {
    const state = openMoveCollectionDialog(makeCollection("b", "a"));
    expect(state.newParentId).toBe(col("a"));
  });

  it("uses null when collection is at root", () => {
    const state = openMoveCollectionDialog(makeCollection("a"));
    expect(state.newParentId).toBeNull();
  });
});

describe("setMoveCollectionParent", () => {
  it("updates newParentId", () => {
    const state: MoveCollectionDialogState = { collectionId: col("a"), collectionName: "A", newParentId: null };
    const next = setMoveCollectionParent(state, col("b"));
    expect(next.newParentId).toBe(col("b"));
  });

  it("can set newParentId to null (root)", () => {
    const state: MoveCollectionDialogState = { collectionId: col("a"), collectionName: "A", newParentId: col("b") };
    const next = setMoveCollectionParent(state, null);
    expect(next.newParentId).toBeNull();
  });

  it("preserves collectionId and name", () => {
    const state: MoveCollectionDialogState = { collectionId: col("a"), collectionName: "Alpha", newParentId: null };
    const next = setMoveCollectionParent(state, col("b"));
    expect(next.collectionId).toBe(col("a"));
    expect(next.collectionName).toBe("Alpha");
  });
});
