import type { DocumentId } from "@dossier/shared";
import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import { Route as rootRoute } from "../../src/routes/__root.js";
import { Route as indexRoute } from "../../src/routes/_auth.index.js";
import { previewAtom, type PreviewTarget } from "../../src/routes/_auth.index.preview.js";
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

const pdfTarget: PreviewTarget = {
  documentId: "doc-1" as DocumentId,
  format: "pdf",
  name: "Invoice 2024.pdf",
};

const imageTarget: PreviewTarget = {
  documentId: "doc-2" as DocumentId,
  format: "png",
  name: "Screenshot.png",
};

function renderWithPreview(target: PreviewTarget | null = null) {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([authRoute.addChildren([indexRoute])]),
    history,
    context: { registry: undefined! },
  });

  function Wrapper() {
    const registry = useContext(RegistryContext);
    registry.set(sessionAtom, unlockedSession);
    if (target !== null) registry.set(previewAtom, target);
    return <RouterProvider router={testRouter} context={{ registry }} />;
  }

  return render(
    <RegistryProvider>
      <Wrapper />
    </RegistryProvider>,
  );
}

describe("DocumentPreview", () => {
  it("is not rendered when no document is selected", async () => {
    renderWithPreview(null);
    await screen.findByRole("heading", { name: "Documents" });
    expect(screen.queryByRole("dialog", { name: /invoice|screenshot/i })).not.toBeInTheDocument();
  });

  it("shows the dialog with the document name when a target is set", async () => {
    renderWithPreview(pdfTarget);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Invoice 2024.pdf")).toBeInTheDocument();
  });

  it("shows an error when the compute service is unavailable", async () => {
    renderWithPreview(pdfTarget);
    await screen.findByRole("dialog");
    expect(await screen.findByText("Failed to load preview.")).toBeInTheDocument();
  });

  it("close button dismisses the dialog", async () => {
    renderWithPreview(pdfTarget);
    const user = userEvent.setup();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking the backdrop dismisses the dialog", async () => {
    renderWithPreview(imageTarget);
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog");
    // Click the outermost overlay (the backdrop), not the inner content panel
    await user.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the document name for image formats too", async () => {
    renderWithPreview(imageTarget);
    await screen.findByRole("dialog");
    expect(screen.getByText("Screenshot.png")).toBeInTheDocument();
  });
});
