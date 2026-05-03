import { createRouter } from "@tanstack/react-router"
import { Route as rootRoute } from "./routes/__root.js"
import { Route as loginRoute } from "./routes/login.js"
import { Route as authRoute } from "./routes/_auth.js"
import { Route as indexRoute } from "./routes/_auth.index.js"

const routeTree = rootRoute.addChildren([loginRoute, authRoute.addChildren([indexRoute])])

export const router = createRouter({
  routeTree,
  context: { registry: undefined! },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
