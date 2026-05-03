import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import type { Registry } from "@effect-atom/atom/Registry"

export interface RouterContext {
  registry: Registry
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
})
