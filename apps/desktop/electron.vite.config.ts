import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/** The renderer ships the page as-is; drop the source indentation so the asar carries no dead whitespace. */
function minifyIndexHtml() {
  return {
    name: "minify-index-html",
    order: "post" as const,
    transformIndexHtml(html: string) {
      return html.replace(/^[ \t]+/gm, "").replace(/\n{2,}/g, "\n");
    }
  };
}

/** Vite rewrites the book URL but does not emit the file. The main bundle reads it beside itself. */ function copyOpeningBook() {
  const from = resolve(rootDir, "../../packages/shared/src/chess/opening-book.txt.zst");
  return {
    name: "copy-opening-book",
    apply: "build" as const,
    closeBundle() {
      copyFileSync(from, resolve(rootDir, "out/main/opening-book.txt.zst"));
    }
  };
}

// Main and preload are fully self-contained bundles (only Node built-ins and
// `electron` stay external), so the packaged app ships no node_modules and
// every package lives in devDependencies.
export default defineConfig({
  main: {
    plugins: [copyOpeningBook()],
    build: {
      // electron-vite leaves minify off. The packaged main bundle is otherwise the
      // readable build, which is most of the asar.
      minify: true,
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(rootDir, "src/main/index.ts"),
          // Worker thread for whole-file puzzle scans (see databases/external-databases.ts).
          "puzzle-scan-worker": resolve(rootDir, "src/main/databases/puzzle-scan-worker.ts"),
          // Worker thread for PGN import parses (see repertoire/import-runner.ts).
          "repertoire-import-worker": resolve(rootDir, "src/main/repertoire/import-worker.ts"),
          // Worker thread storing import commits on its own connection (repertoire/import-writer.ts).
          "repertoire-import-writer-worker": resolve(
            rootDir,
            "src/main/repertoire/import-writer-worker.ts"
          ),
          // Worker thread restoring backups on its own connection (repertoire/backup-restore-runner.ts).
          "repertoire-backup-restore-worker": resolve(
            rootDir,
            "src/main/repertoire/backup-restore-worker.ts"
          )
        }
      }
    }
  },
  preload: {
    build: {
      minify: true,
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
    plugins: [react(), tailwindcss(), minifyIndexHtml()],
    assetsInclude: ["**/*.css.gz"],
    build: {
      // electron-vite's renderer preset sets minify: false, so the shipped JS is the
      // readable build. Minify it; the sounds exception below is unchanged.
      minify: true,
      // Sounds stay files: Vite would inline the small ones as data: URLs, which the packaged app's
      // CSP (media-src 'self') blocks, silencing them.
      assetsInlineLimit: (filePath) => (/\.(mp3|wav|ogg)$/i.test(filePath) ? false : undefined)
    },
    server: {
      host: "127.0.0.1"
    },
    resolve: {
      alias: { "@": resolve(rootDir, "src/renderer/src") }
    }
  }
});
