import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import { Route as rootRoute } from "../../src/routes/__root.js";
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

function renderDocumentsPage() {
  const history = createMemoryHistory({ initialEntries: ["/"] });
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([authRoute.addChildren([indexRoute])]),
    history,
    context: { registry: undefined! },
  });

  function Wrapper() {
    const registry = useContext(RegistryContext);
    registry.set(sessionAtom, unlockedSession);
    return <RouterProvider router={testRouter} context={{ registry }} />;
  }

  return render(
    <RegistryProvider>
      <Wrapper />
    </RegistryProvider>,
  );
}

describe("DocumentsPage", () => {
  it("renders the heading and search input", async () => {
    renderDocumentsPage();
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by name…")).toBeInTheDocument();
  });

  it("renders sort buttons for Name and Date", async () => {
    renderDocumentsPage();
    await screen.findByRole("heading", { name: "Documents" });
    expect(screen.getByRole("button", { name: /^Name/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Date/ })).toBeInTheDocument();
  });

  it("Date is active by default with descending order", async () => {
    renderDocumentsPage();
    await screen.findByRole("heading", { name: "Documents" });
    // Active button shows a direction arrow
    expect(screen.getByRole("button", { name: /^Date ↓/ })).toBeInTheDocument();
    // Inactive button has no arrow
    expect(screen.getByRole("button", { name: "Name" })).toBeInTheDocument();
  });

  it("clicking Name activates it with descending order", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Name" }));
    expect(screen.getByRole("button", { name: /^Name ↓/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date" })).toBeInTheDocument();
  });

  it("clicking the active sort button toggles the direction", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    // Click Date (already active, desc) → should become asc
    await user.click(await screen.findByRole("button", { name: /^Date ↓/ }));
    expect(screen.getByRole("button", { name: /^Date ↑/ })).toBeInTheDocument();
    // Click again → back to desc
    await user.click(screen.getByRole("button", { name: /^Date ↑/ }));
    expect(screen.getByRole("button", { name: /^Date ↓/ })).toBeInTheDocument();
  });

  it("switching sort field resets direction to descending", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    // Toggle Date to ascending so the active direction is asc
    await user.click(await screen.findByRole("button", { name: /^Date ↓/ }));
    expect(screen.getByRole("button", { name: /^Date ↑/ })).toBeInTheDocument();
    // Click Name → Name becomes active with desc; Date becomes inactive (no arrow)
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getByRole("button", { name: /^Name ↓/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date" })).toBeInTheDocument();
  });

  it("search input accepts text", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("Search by name…");
    await user.type(input, "invoice");
    expect(input).toHaveValue("invoice");
  });
});

describe("DocumentsPage / UploadDialog", () => {
  it("renders an Upload button", async () => {
    renderDocumentsPage();
    expect(await screen.findByRole("button", { name: "Upload" })).toBeInTheDocument();
  });

  it("dialog is not visible initially", async () => {
    renderDocumentsPage();
    await screen.findByRole("button", { name: "Upload" });
    expect(screen.queryByRole("heading", { name: "Upload document" })).not.toBeInTheDocument();
  });

  it("clicking Upload opens the dialog", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    expect(screen.getByRole("heading", { name: "Upload document" })).toBeInTheDocument();
  });

  it("dialog has file, name, and tag fields", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("File")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tags")).toBeInTheDocument();
  });

  it("Upload submit button is disabled when no file is selected", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("clicking Cancel closes the dialog", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Upload document" })).not.toBeInTheDocument();
  });

  it("typing a tag and pressing Enter adds a chip", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const tagInput = screen.getByPlaceholderText("Add tag and press Enter…");
    await user.type(tagInput, "finance{Enter}");
    expect(screen.getByText("finance")).toBeInTheDocument();
    expect(tagInput).toHaveValue("");
  });

  it("removing a tag chip removes it from the list", async () => {
    renderDocumentsPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const tagInput = screen.getByPlaceholderText("Add tag and press Enter…");
    await user.type(tagInput, "legal{Enter}");
    await user.click(screen.getByRole("button", { name: "Remove tag legal" }));
    expect(screen.queryByText("legal")).not.toBeInTheDocument();
  });
});
