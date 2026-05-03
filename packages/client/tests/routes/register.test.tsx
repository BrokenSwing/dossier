import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useContext } from "react"
import { describe, expect, it } from "vitest"

import { Route as rootRoute } from "../../src/routes/__root.js"
import { Route as registerRoute } from "../../src/routes/register.js"

function renderRegisterPage() {
  const history = createMemoryHistory({ initialEntries: ["/register"] })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([registerRoute]),
    history,
    context: { registry: undefined! },
  })

  function Wrapper() {
    const registry = useContext(RegistryContext)
    return <RouterProvider router={testRouter} context={{ registry }} />
  }

  return render(
    <RegistryProvider>
      <Wrapper />
    </RegistryProvider>,
  )
}

describe("RegisterPage / CredentialsStep", () => {
  it("renders all form fields", async () => {
    renderRegisterPage()
    expect(await screen.findByRole("heading", { name: "Create account" })).toBeInTheDocument()
    expect(screen.getByLabelText("Username")).toBeInTheDocument()
    expect(screen.getByLabelText("Password")).toBeInTheDocument()
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument()
  })

  it("has a link to the sign-in page", async () => {
    renderRegisterPage()
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument()
  })

  it("shows a mismatch error when passwords differ", async () => {
    renderRegisterPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Password"), "secret123")
    await user.type(screen.getByLabelText("Confirm password"), "different")
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument()
  })

  it("hides the mismatch error when passwords match", async () => {
    renderRegisterPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Password"), "secret123")
    await user.type(screen.getByLabelText("Confirm password"), "secret123")
    expect(screen.queryByText("Passwords do not match.")).not.toBeInTheDocument()
  })

  it("disables submit when passwords do not match", async () => {
    renderRegisterPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Password"), "secret123")
    await user.type(screen.getByLabelText("Confirm password"), "different")
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
  })

  it("enables submit when username and matching passwords are filled", async () => {
    renderRegisterPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Username"), "alice")
    await user.type(screen.getByLabelText("Password"), "secret123")
    await user.type(screen.getByLabelText("Confirm password"), "secret123")
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled()
  })

  it("disables submit while the registration request is in flight", async () => {
    renderRegisterPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Username"), "alice")
    await user.type(screen.getByLabelText("Password"), "secret123")
    await user.type(screen.getByLabelText("Confirm password"), "secret123")
    // Click submit — registration will never resolve in tests (no server), but the
    // button should immediately switch to the loading label.
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled()
  })
})
