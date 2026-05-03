import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";

import { Route as loginRoute } from "../../src/routes/login.js";
import { Route as rootRoute } from "../../src/routes/__root.js";
import { sessionAtom, SessionState } from "../../src/session.js";

function renderLoginPage(initialSession?: ReturnType<typeof SessionState.Locked>) {
  const history = createMemoryHistory({ initialEntries: ["/login"] });
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([loginRoute]),
    history,
    context: { registry: undefined! },
  });

  function Wrapper() {
    const registry = useContext(RegistryContext);
    if (initialSession) {
      registry.set(sessionAtom, initialSession);
    }
    return <RouterProvider router={testRouter} context={{ registry }} />;
  }

  return render(
    <RegistryProvider>
      <Wrapper />
    </RegistryProvider>,
  );
}

// Salt must be at least 8 bytes for argon2id; use a realistic hex value.
const lockedSession = SessionState.Locked({
  token: "tok",
  username: "alice",
  encryptedDek: "enc",
  dekIv: "iv",
  kdfParams: { algorithm: "argon2id", salt: "0011223344556677", memory: 65536, iterations: 3, parallelism: 1 },
});

describe("LoginPage / LoginForm", () => {
  it("renders the login form when no session exists", async () => {
    renderLoginPage();
    expect(await screen.findByRole("heading", { name: "Sign in to Dossier" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument();
  });

  it("has a link to the register page", async () => {
    renderLoginPage();
    expect(await screen.findByRole("link", { name: "Create one" })).toBeInTheDocument();
  });

  it("disables submit until a 6-digit TOTP code is entered", async () => {
    renderLoginPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await user.type(screen.getByLabelText("Authenticator code"), "12345");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await user.type(screen.getByLabelText("Authenticator code"), "6");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("strips non-numeric characters from the TOTP input", async () => {
    renderLoginPage();
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Authenticator code");
    await user.type(input, "1a2b3c");
    expect(input).toHaveValue("123");
  });

  it("submit button is disabled while the TOTP code is incomplete", async () => {
    renderLoginPage();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.type(screen.getByLabelText("Authenticator code"), "12345");
    // 5 digits — still disabled
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});

describe("LoginPage / UnlockForm", () => {
  it("renders the unlock form when a locked session exists", async () => {
    renderLoginPage(lockedSession);
    expect(await screen.findByRole("heading", { name: /Welcome back/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument();
  });

  it("displays the locked username in the heading", async () => {
    renderLoginPage(lockedSession);
    expect(await screen.findByText(/Welcome back, alice/)).toBeInTheDocument();
  });

  it("enables the unlock button when password is entered", async () => {
    renderLoginPage(lockedSession);
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: "Unlock" });
    // The button has no disabled state other than the loading one
    expect(btn).toBeEnabled();
    await user.type(screen.getByLabelText("Password"), "secret");
    expect(btn).toBeEnabled();
  });

  it("shows loading state while unlocking", async () => {
    renderLoginPage(lockedSession);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(screen.getByRole("button", { name: "Unlocking…" })).toBeDisabled();
  });

  it("clears the session when Sign out is clicked", async () => {
    const { container: _c } = renderLoginPage(lockedSession);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    // After sign out, the full login form should appear
    expect(await screen.findByRole("heading", { name: "Sign in to Dossier" })).toBeInTheDocument();
  });
});
