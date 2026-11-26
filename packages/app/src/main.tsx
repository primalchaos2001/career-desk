import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getRouter } from "./router";
import "./styles.css";

/**
 * Client-only SPA entry (D-026, and the Start→SPA conversion ADR). The Lovable
 * prototype shipped as TanStack Start with an SSR server entry; we drop the
 * server runtime entirely so the build artifact is fully static (D-010/D-011)
 * and mount the router in the browser here.
 */
const router = getRouter();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
