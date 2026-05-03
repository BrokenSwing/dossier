import { RegistryContext, RegistryProvider } from "@effect-atom/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useContext } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { router } from "./router.js";

function App() {
  const registry = useContext(RegistryContext);
  return <RouterProvider router={router} context={{ registry }} />;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>,
);
