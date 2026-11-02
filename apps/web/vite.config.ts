import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Emits sw.js with every built file to precache and a version that changes with the build.
function serviceWorker(): Plugin {
  return {
    name: "simulacrum-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map"))
        .sort();
      const statics = ["favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify([...files, ...statics]));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the built site works from any folder or subpath.
  base: "./",
  plugins: [react(), tailwindcss(), serviceWorker()],
});
