import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import type * as RegistryModule from "@effect-atom/atom/Registry";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import type { Collection, CollectionId } from "@dossier/shared";
import { Route as indexRoute } from "../../src/routes/_auth.index.js";
import {
  confirmDeleteCollectionAtom,
  createCollectionDialogAtom,
  editCollectionDialogAtom,
  moveCollectionDialogAtom,
  openCreateCollectionDialog,
  openEditCollectionDialog,
  openMoveCollectionDialog,
} from "../../src/routes/_auth.index.collections.js";
import { Route as authRoute } from "../../src/routes/_auth.js";
import { Route as rootRoute } from "../../src/routes/__root.js";
import { sessionAtom, SessionState } from "../../src/session.js";

const unlockedSession = SessionState.Unlocked({
  token: "test-token",
  username: "alice",
  encryptedDek: "enc",
  dekIv: "iv",
  kdfParams: { memory: 65536, iterations: 3, parallelism: 1, salt: "0011223344556677" },
  dek: new Uint8Array(32),
});

const col = (id: string) => id as CollectionId;

const collection: Collection = {
  id: col("col-1"),
  name: "Finance",
  parentId: null,
  watermark: { text: "CONFIDENTIAL" },
  createdAt: "2024-01-01T00:00:00Z",
} as unknown as Collection;

function renderWithAtoms(seed: (registry: RegistryModule.Registry) => void = () => {}) {
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

describe("CollectionSidebar", () => {
  it("renders the Collections heading", async () => {
    renderWithAtoms();
    expect(await screen.findByRole("heading", { name: "Collections" })).toBeInTheDocument();
  });

  it("renders the 'All documents' button", async () => {
    renderWithAtoms();
    expect(await screen.findByRole("button", { name: "All documents" })).toBeInTheDocument();
  });

  it("renders the New collection button", async () => {
    renderWithAtoms();
    expect(await screen.findByRole("button", { name: "New collection" })).toBeInTheDocument();
  });

  it("clicking New collection opens the create dialog", async () => {
    renderWithAtoms();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New collection" }));
    expect(await screen.findByRole("dialog", { name: /new collection/i })).toBeInTheDocument();
  });
});

describe("CreateCollectionDialog", () => {
  it("is not shown when createCollectionDialogAtom is null", async () => {
    renderWithAtoms();
    await screen.findByRole("button", { name: "All documents" });
    expect(screen.queryByRole("dialog", { name: /new collection/i })).not.toBeInTheDocument();
  });

  it("shows when createCollectionDialogAtom is set", async () => {
    renderWithAtoms((r) => r.set(createCollectionDialogAtom, openCreateCollectionDialog(null)));
    expect(await screen.findByRole("dialog", { name: /new collection/i })).toBeInTheDocument();
  });

  it("shows 'New sub-collection' when parentId is set", async () => {
    renderWithAtoms((r) => r.set(createCollectionDialogAtom, openCreateCollectionDialog(col("col-1"))));
    expect(await screen.findByRole("dialog", { name: /new sub-collection/i })).toBeInTheDocument();
  });

  it("Create button is disabled when name is empty", async () => {
    renderWithAtoms((r) => r.set(createCollectionDialogAtom, openCreateCollectionDialog(null)));
    await screen.findByRole("dialog", { name: /new collection/i });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("Cancel closes the dialog", async () => {
    renderWithAtoms((r) => r.set(createCollectionDialogAtom, openCreateCollectionDialog(null)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /new collection/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /new collection/i })).not.toBeInTheDocument();
  });

  it("typing in the name enables the Create button", async () => {
    renderWithAtoms((r) => r.set(createCollectionDialogAtom, openCreateCollectionDialog(null)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /new collection/i });
    await user.type(screen.getByLabelText("Name"), "Finance");
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });
});

describe("EditCollectionDialog", () => {
  it("is not shown when editCollectionDialogAtom is null", async () => {
    renderWithAtoms();
    await screen.findByRole("button", { name: "All documents" });
    expect(screen.queryByRole("dialog", { name: /edit collection/i })).not.toBeInTheDocument();
  });

  it("shows with collection name pre-filled", async () => {
    renderWithAtoms((r) => r.set(editCollectionDialogAtom, openEditCollectionDialog(collection)));
    await screen.findByRole("dialog", { name: /edit collection/i });
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Finance");
  });

  it("shows with watermark text pre-filled", async () => {
    renderWithAtoms((r) => r.set(editCollectionDialogAtom, openEditCollectionDialog(collection)));
    await screen.findByRole("dialog", { name: /edit collection/i });
    const input = screen.getByLabelText("Watermark text") as HTMLInputElement;
    expect(input.value).toBe("CONFIDENTIAL");
  });

  it("Save button is disabled when name is empty", async () => {
    renderWithAtoms((r) => r.set(editCollectionDialogAtom, { collectionId: col("x"), name: "", watermarkText: "" }));
    await screen.findByRole("dialog", { name: /edit collection/i });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Cancel closes the dialog", async () => {
    renderWithAtoms((r) => r.set(editCollectionDialogAtom, openEditCollectionDialog(collection)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /edit collection/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /edit collection/i })).not.toBeInTheDocument();
  });
});

describe("DeleteCollectionConfirmDialog", () => {
  it("is not shown when confirmDeleteCollectionAtom is null", async () => {
    renderWithAtoms();
    await screen.findByRole("button", { name: "All documents" });
    expect(screen.queryByRole("dialog", { name: /delete collection/i })).not.toBeInTheDocument();
  });

  it("shows with collection name", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteCollectionAtom, collection));
    await screen.findByRole("dialog", { name: /delete collection/i });
    expect(screen.getByText(/Finance/)).toBeInTheDocument();
  });

  it("has recursive checkbox unchecked by default", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteCollectionAtom, collection));
    await screen.findByRole("dialog", { name: /delete collection/i });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("Delete button is enabled", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteCollectionAtom, collection));
    await screen.findByRole("dialog", { name: /delete collection/i });
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });

  it("Cancel closes the dialog", async () => {
    renderWithAtoms((r) => r.set(confirmDeleteCollectionAtom, collection));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /delete collection/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /delete collection/i })).not.toBeInTheDocument();
  });
});

describe("MoveCollectionDialog", () => {
  it("is not shown when moveCollectionDialogAtom is null", async () => {
    renderWithAtoms();
    await screen.findByRole("button", { name: "All documents" });
    expect(screen.queryByRole("dialog", { name: /move/i })).not.toBeInTheDocument();
  });

  it("shows with collection name in the heading", async () => {
    renderWithAtoms((r) => r.set(moveCollectionDialogAtom, openMoveCollectionDialog(collection)));
    expect(await screen.findByRole("dialog", { name: /Finance/i })).toBeInTheDocument();
  });

  it("has a parent select defaulting to root", async () => {
    renderWithAtoms((r) => r.set(moveCollectionDialogAtom, openMoveCollectionDialog(collection)));
    await screen.findByRole("dialog", { name: /Finance/i });
    const select = screen.getByLabelText("New parent") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("Cancel closes the dialog", async () => {
    renderWithAtoms((r) => r.set(moveCollectionDialogAtom, openMoveCollectionDialog(collection)));
    const user = userEvent.setup();
    await screen.findByRole("dialog", { name: /Finance/i });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: /Finance/i })).not.toBeInTheDocument();
  });
});
