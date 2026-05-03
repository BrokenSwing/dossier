import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <h1 className="text-2xl font-semibold text-gray-900">Dossier</h1>
    </div>
  </StrictMode>,
);
