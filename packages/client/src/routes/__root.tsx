import type { Registry } from "@effect-atom/atom/Registry";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export interface RouterContext {
  registry: Registry;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});
