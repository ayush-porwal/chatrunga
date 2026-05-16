import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(rootDir, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(rootDir, "src/preload/index.ts")
        }
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
      alias: {
        "@": resolve(rootDir, "src/renderer/src"),
        "@renderer": resolve(rootDir, "src/renderer/src")
      }
    }
  }
});
