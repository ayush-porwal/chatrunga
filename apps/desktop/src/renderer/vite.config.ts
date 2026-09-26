import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rendererDir = fileURLToPath(new URL(".", import.meta.url));

// Standalone renderer (`vite src/renderer`) for browser-only UI work; the app itself is built
// by ../../electron.vite.config.ts, whose renderer section this mirrors.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(rendererDir, "src") }
  },
  server: {
    host: "127.0.0.1"
  }
});
