import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { registerSW } from "virtual:pwa-register";

import { routeTree } from "./routeTree.gen";
import { applyDarkModeClass, readDarkModePref } from "./lib/theme";
import "./styles.css";

// Apply the saved theme before the first paint — this used to only happen
// once ProfilePage (the settings screen) mounted, so the rest of the app
// rendered light until you happened to open Profile, and opening it then
// flipped the whole app to dark with no toggle tapped.
applyDarkModeClass(readDarkModePref());

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info("[pwa] Driver portal ready for offline shell");
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
