import type { CollectionId, DocumentId, DocumentMeta } from "@dossier/shared";
import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import type * as RegistryModule from "@effect-atom/atom/Registry";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import { Route as rootRoute } from "../../src/routes/__root.js";
import {
  confirmDeleteAtom,
  editDocumentDialogAtom,
  openEditDocumentDialog,
  openRenameDialog,
  renameDialogAtom,
} from "../../src/routes/_auth.index.actions.js";
import { Route as indexRoute } from "../../src/routes/_auth.index.js";
import { Route as authRoute } from "../../src/routes/_auth.js";
import { sessionAtom, SessionState } from "../../src/session.js";

const unlockedSession = SessionState.Unlocked({
  token: "test-token",
  username: "alice",
  encryptedDek: "enc",
  dekIv: "iv",
  kdfParams: { memory: 65536, iterations: 3, parallelism: 1, salt: "0011223344556677" },
  dek: new Uint8Array(32),
});

const doc: DocumentMeta = {
  id: "doc-1" as DocumentId,
  name: "Invoice 2024",
  format: "pdf",
  tags: ["finance"],
  collectionIds: [] as unknown as CollectionId[],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  encryptedSize: 1024,
};

function renderWithAtoms(seed: (registry: RegistryModule.Registry) => void) {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([authRoute.addChildren([indexRoute])]),
    history,
    context: { registry: undefined! },
  });

  function Wrapper() {
    const registry = useContext(RegistryContext);
    registry.set(sessionAtom, unlockedSession);
    seed(registry);
    return <RouterProvider router={testRouter} context={{ registry }} />;
  }

  return render(
    <RegistryProvider>
      <Wrapper />
    </RegistryProvider>,
  );
}

describe("RenameDialog", () => {
  it("is not rendered when renameDialogAtom is null", async () => {
    renderWithAtoms(() => {});
    await screen.findByRole("heading", { name: "Documents" });
    expect(screen.queryByRole("dialog", { name: /rename/i })).not.toBeInTheDocument();
  });

  it("shows the rename dialog with the document name pre-filled", async () => {
    renderWithAtoms((r) => r.set(renameDialogAtom, openRenameDialog(doc)));
    const dialog = await screen.findByRole("dialog", { name: /rename/i });
    expect(dialog).toBeInTheDocument();
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Invoice 2024");
  });

  it("Cancel button dismisses the rename dialog", async () => {
    renderWithAtoms((r) => r.set(renameDialogAtom, openRenameDialog(doc)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /rename/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /rename/i })).not.toBeInTheDocument();
  });

  it("Save button is disabled when name is empty", async () => {
    renderWithAtoms((r) => r.set(renameDialogAtom, { documentId: doc.id, name: "" }));
    await screen.findByRole("dialog", { name: /rename/i });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Save button is enabled when name is not empty", async () => {
    renderWithAtoms((r) => r.set(renameDialogAtom, openRenameDialog(doc)));
    await screen.findByRole("dialog", { name: /rename/i });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});

describe("EditDocumentDialog", () => {
  it("is not rendered when editDocumentDialogAtom is null", async () => {
    renderWithAtoms(() => {});
    await screen.findByRole("heading", { name: "Documents" });
    expect(screen.queryByRole("dialog", { name: /edit document/i })).not.toBeInTheDocument();
  });

  it("shows the edit dialog with existing tags as chips", async () => {
    renderWithAtoms((r) => r.set(editDocumentDialogAtom, openEditDocumentDialog(doc)));
    await screen.findByRole("dialog", { name: /edit document/i });
    expect(screen.getByText("finance")).toBeInTheDocument();
  });

  it("Cancel button dismisses the edit dialog", async () => {
    renderWithAtoms((r) => r.set(editDocumentDialogAtom, openEditDocumentDialog(doc)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /edit document/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /edit document/i })).not.toBeInTheDocument();
  });

  it("typing a tag and pressing Enter adds a chip", async () => {
    renderWithAtoms((r) => r.set(editDocumentDialogAtom, openEditDocumentDialog(doc)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /edit document/i });
    const input = screen.getByPlaceholderText("Add tag and press Enter…");
    await user.type(input, "legal{Enter}");
    expect(screen.getByText("legal")).toBeInTheDocument();
  });

  it("removing a tag chip removes it from the list", async () => {
    renderWithAtoms((r) => r.set(editDocumentDialogAtom, openEditDocumentDialog(doc)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /edit document/i });
    await user.click(screen.getByRole("button", { name: "Remove tag finance" }));
    expect(screen.queryByText("finance")).not.toBeInTheDocument();
  });
});

describe("DeleteConfirmDialog", () => {
  it("is not rendered when confirmDeleteAtom is null", async () => {
    renderWithAtoms(() => {});
    await screen.findByRole("heading", { name: "Documents" });
    expect(screen.queryByRole("dialog", { name: /delete document/i })).not.toBeInTheDocument();
  });

  it("shows the delete confirmation dialog with the document name", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteAtom, doc));
    const dialog = await screen.findByRole("dialog", { name: /delete document/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Invoice 2024/)).toBeInTheDocument();
  });

  it("Cancel button dismisses the delete dialog", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteAtom, doc));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /delete document/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /delete document/i })).not.toBeInTheDocument();
  });

  it("Delete button is present and enabled", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteAtom, doc));
    await screen.findByRole("dialog", { name: /delete document/i });
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });
});
