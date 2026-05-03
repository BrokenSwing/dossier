import { createRoute, Outlet, redirect } from "@tanstack/react-router";

import { sessionAtom } from "../session.js";
import { Route as rootRoute } from "./__root.js";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  id: "_auth",
  beforeLoad: ({ context }) => {
    const session = context.registry.get(sessionAtom);
    if (session._tag !== "Unlocked") {
      throw redirect({ to: "/login" });
    }
  },
  component: AppShell,
});

function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-base font-semibold text-gray-900">Dossier</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        <SidebarSection title="Collections">
          <p className="px-2 py-1 text-xs text-gray-400">No collections yet.</p>
        </SidebarSection>
        <SidebarSection title="Tags">
          <p className="px-2 py-1 text-xs text-gray-400">No tags yet.</p>
        </SidebarSection>
      </nav>
    </aside>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-2 py-1 text-xs font-medium tracking-wide text-gray-400 uppercase">{title}</h2>
      {children}
    </section>
  );
}
