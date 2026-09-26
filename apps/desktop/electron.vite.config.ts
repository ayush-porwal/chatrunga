import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Main and preload are fully self-contained bundles (only Node built-ins and
// `electron` stay external), so the packaged app ships no node_modules and
// every package lives in devDependencies.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: { index: resolve(rootDir, "src/main/index.ts") }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: { index: resolve(rootDir, "src/preload/index.ts") },
        // The window is sandboxed, and sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" }
      }
    }
  },
  renderer: {
    root: resolve(rootDir, "src/renderer"),
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1"
    },
    resolve: {
      alias: { "@": resolve(rootDir, "src/renderer/src") }
    }
  }
});
