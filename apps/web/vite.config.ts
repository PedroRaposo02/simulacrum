import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths so the built site works from any folder or subpath.
  base: "./",
  plugins: [react(), tailwindcss()],
});
