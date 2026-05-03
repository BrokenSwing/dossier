import { createRoute } from "@tanstack/react-router";

import { Route as authRoute } from "./_auth.js";

export const Route = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  component: DocumentsPage,
});

function DocumentsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-gray-900">Documents</h1>
      <p className="mt-2 text-sm text-gray-500">Document list coming soon.</p>
    </div>
  );
}
