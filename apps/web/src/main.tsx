import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyTheme, savedTheme } from "./theme";
import { IS_DESKTOP, routeExternalLinks } from "./desktop";

applyTheme(savedTheme());
import App from "./App";

// Offline use and the installable app; not in dev (it would cache the dev server), from a file or
// in the desktop app (its files are already local).
if (import.meta.env.PROD && !IS_DESKTOP && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
routeExternalLinks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
