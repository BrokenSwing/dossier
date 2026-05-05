import type { DocumentId, DocumentMeta, ExportFormat, ExportStructure } from "@dossier/shared";
import { describe, expect, it } from "vitest";

import {
  deselectAllDocs,
  openExportDialog,
  selectAllDocs,
  setExportFormat,
  setExportStructureMode,
  setExportWatermarkText,
  toggleExportDoc,
  type ExportDialogState,
} from "../../src/routes/_auth.index.export.js";

const id = (s: string) => s as DocumentId;

const doc = (docId: string): DocumentMeta =>
  ({
    id: id(docId),
    name: `Doc ${docId}`,
    format: "pdf",
    encryptedSize: 100,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tags: [],
    collectionIds: [],
  }) as unknown as DocumentMeta;

const baseState: ExportDialogState = {
  selectedDocIds: [id("d1"), id("d2")],
  format: "zip",
  structureMode: "flatten",
  watermarkText: "",
};

describe("openExportDialog", () => {
  it("pre-selects all provided docs", () => {
    const docs = [doc("a"), doc("b"), doc("c")];
    const state = openExportDialog(docs);
    expect(state.selectedDocIds).toEqual([id("a"), id("b"), id("c")]);
  });

  it("defaults to zip format and flatten structure", () => {
    const state = openExportDialog([]);
    expect(state.format).toBe("zip");
    expect(state.structureMode).toBe("flatten");
    expect(state.watermarkText).toBe("");
  });

  it("handles empty doc list", () => {
    const state = openExportDialog([]);
    expect(state.selectedDocIds).toEqual([]);
  });
});

describe("toggleExportDoc", () => {
  it("deselects a selected doc", () => {
    const result = toggleExportDoc(baseState, id("d1"));
    expect(result.selectedDocIds).toEqual([id("d2")]);
  });

  it("selects an unselected doc", () => {
    const result = toggleExportDoc(baseState, id("d3"));
    expect(result.selectedDocIds).toEqual([id("d1"), id("d2"), id("d3")]);
  });

  it("does not mutate the original state", () => {
    const orig = [...baseState.selectedDocIds];
    toggleExportDoc(baseState, id("d1"));
    expect(baseState.selectedDocIds).toEqual(orig);
  });

  it("can deselect the last selected doc", () => {
    const state = { ...baseState, selectedDocIds: [id("d1")] };
    expect(toggleExportDoc(state, id("d1")).selectedDocIds).toEqual([]);
  });
});

describe("selectAllDocs", () => {
  it("replaces selection with all doc ids", () => {
    const state = { ...baseState, selectedDocIds: [] };
    const result = selectAllDocs(state, [doc("x"), doc("y")]);
    expect(result.selectedDocIds).toEqual([id("x"), id("y")]);
  });

  it("preserves other fields", () => {
    const result = selectAllDocs(baseState, [doc("x")]);
    expect(result.format).toBe(baseState.format);
    expect(result.structureMode).toBe(baseState.structureMode);
  });
});

describe("deselectAllDocs", () => {
  it("clears selected doc ids", () => {
    expect(deselectAllDocs(baseState).selectedDocIds).toEqual([]);
  });

  it("preserves other fields", () => {
    const result = deselectAllDocs(baseState);
    expect(result.format).toBe(baseState.format);
    expect(result.watermarkText).toBe(baseState.watermarkText);
  });
});

describe("setExportFormat", () => {
  it("sets format to tar.gz", () => {
    const result = setExportFormat(baseState, "tar.gz" as ExportFormat);
    expect(result.format).toBe("tar.gz");
  });

  it("preserves other fields", () => {
    const result = setExportFormat(baseState, "tar.gz" as ExportFormat);
    expect(result.selectedDocIds).toEqual(baseState.selectedDocIds);
  });
});

describe("setExportStructureMode", () => {
  it("sets structure mode to preserve", () => {
    const result = setExportStructureMode(baseState, "preserve" as ExportStructure);
    expect(result.structureMode).toBe("preserve");
  });

  it("sets structure mode to flatten", () => {
    const state = { ...baseState, structureMode: "preserve" as ExportStructure };
    expect(setExportStructureMode(state, "flatten" as ExportStructure).structureMode).toBe("flatten");
  });
});

describe("setExportWatermarkText", () => {
  it("sets watermark text", () => {
    const result = setExportWatermarkText(baseState, "CONFIDENTIAL");
    expect(result.watermarkText).toBe("CONFIDENTIAL");
  });

  it("allows clearing watermark text", () => {
    const state = { ...baseState, watermarkText: "OLD" };
    expect(setExportWatermarkText(state, "").watermarkText).toBe("");
  });
});
