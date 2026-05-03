import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react";
import { createRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, SessionState } from "../session.js";
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

// --- Atom ---

const logoutAtom = StorageRpc.runtime.fn<void>()(
  (_arg, get) =>
    Effect.gen(function* () {
      const session = get(sessionAtom);
      if (session._tag !== "Unlocked") return;
      const client = yield* StorageRpc;
      yield* client("Logout", undefined, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
    }),
);

// --- Shell ---

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
  const session = useAtomValue(sessionAtom);
  const navigate = useNavigate();
  const logout = useAtomSet(logoutAtom, { mode: "promiseExit" });
  const setSession = useAtomSet(sessionAtom);

  async function handleLogout() {
    await logout();
    setSession(SessionState.LoggedOut());
    void navigate({ to: "/login" });
  }

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
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-gray-700">
            {session._tag === "Unlocked" ? session.username : ""}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
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
