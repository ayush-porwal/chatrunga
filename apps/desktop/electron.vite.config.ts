import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import { build as viteBuild } from "vite";
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

const maiaVendorDir = resolve(rootDir, "vendor/csslab-maia");
const onnxRuntimeWeb = resolve(rootDir, "node_modules/onnxruntime-web");
const onnxRuntimeDist = resolve(onnxRuntimeWeb, "dist");
/** The onnxruntime-common onnxruntime-web itself depends on (the same release, pinned exactly). */
const onnxRuntimeCommon = resolve(
  dirname(createRequire(resolve(onnxRuntimeWeb, "package.json")).resolve("onnxruntime-common")),
  "../esm/index.js"
);
/** The ONNX Runtime files CSSLab's worker loads from `/ort/` (byte-identical to their public/ort). */
const ORT_FILES = ["ort.wasm.min.js", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

/**
 * The hidden Maia host page (src/maia-host, see main/maia/maia-host.ts) as its own Vite build
 * into out/maia-host, beside main's: the page script, CSSLab's worker and the ONNX Runtime files,
 * at the paths CSSLab's code asks for them by (`/maia-worker.js`, `/ort/`).
 */
function buildMaiaHost() {
  const outDir = resolve(rootDir, "out/maia-host");
  return {
    name: "build-maia-host",
    apply: "build" as const,
    async closeBundle() {
      await viteBuild({
        configFile: false,
        root: resolve(rootDir, "src/maia-host"),
        base: "/",
        logLevel: "warn",
        resolve: {
          alias: {
            // CSSLab's maia.ts takes MaiaStatus from their types module (a type, so nothing of
            // it is bundled) and only `Tensor` from onnxruntime-web, which re-exports it from
            // onnxruntime-common. Resolving the page's import there keeps a second runtime (and
            // a second copy of its wasm) out of the page: the worker runs ONNX Runtime itself.
            "src/types": resolve(rootDir, "src/maia-host/upstream-types.ts"),
            "onnxruntime-web": onnxRuntimeCommon
          }
        },
        build: {
          outDir,
          emptyOutDir: true,
          minify: true,
          modulePreload: false,
          // One script at a fixed name: main serves only a fixed list of files.
          rollupOptions: { output: { entryFileNames: "main.js", codeSplitting: false } }
        }
      });
      copyFileSync(
        resolve(maiaVendorDir, "public/maia-worker.js"),
        resolve(outDir, "maia-worker.js")
      );
      mkdirSync(resolve(outDir, "ort"), { recursive: true });
      for (const file of ORT_FILES)
        copyFileSync(resolve(onnxRuntimeDist, file), resolve(outDir, "ort", file));
    }
  };
}

// Main and preload are fully self-contained bundles (only Node built-ins and
// `electron` stay external), so the packaged app ships no node_modules and
// every package lives in devDependencies.
export default defineConfig({
  main: {
    plugins: [copyOpeningBook(), buildMaiaHost()],
    // keepNames survives function/class names through minification, so production stack
    // traces in logs stay attributable (error.name comparisons are explicit strings either way).
    esbuild: { keepNames: true },
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
    // Same keepNames rationale as main: sandboxed preload stack traces stay attributable.
    esbuild: { keepNames: true },
    build: {
      minify: true,
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(rootDir, "src/preload/index.ts"),
          // The hidden Maia host window's (main/maia/maia-host.ts).
          "maia-host": resolve(rootDir, "src/preload/maia-host.ts")
        },
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
      // CSP (media-src 'self') blocks, silencing them. Engine logos stay files too, out of the
      // startup chunk.
      assetsInlineLimit: (filePath) =>
        /\.(mp3|wav|ogg)$/i.test(filePath) || /[\\/]assets[\\/]engines[\\/]/.test(filePath)
          ? false
          : undefined,
      rollupOptions: {
        // Setting any option here makes electron-vite ask for the entry it otherwise defaults to.
        input: resolve(rootDir, "src/renderer/index.html"),
        output: {
          // Libraries in their own chunks, apart from the app's code: a release that only changes
          // the app leaves them byte-identical, so the updater's differential download skips them.
          codeSplitting: {
            groups: [
              {
                name: "react",
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 20
              },
              { name: "vendor", test: /[\\/]node_modules[\\/]/, priority: 10, entriesAware: true }
            ]
          }
        }
      }
    },
    server: {
      host: "127.0.0.1"
    },
    resolve: {
      alias: { "@": resolve(rootDir, "src/renderer/src") }
    }
  }
});
