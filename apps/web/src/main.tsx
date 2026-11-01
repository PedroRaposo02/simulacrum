import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyTheme, savedTheme } from "./theme";

applyTheme(savedTheme());
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
