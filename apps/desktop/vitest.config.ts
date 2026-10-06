import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Locally, half the cores: a full run leaves the machine usable. CI keeps them all.
    maxWorkers: process.env.CI ? undefined : "50%",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Pure logic in main and the renderer. Excluded: Electron / SQLite / process glue and
      // React hooks + class-name tables, which are exercised by running the app, not unit tests.
      include: ["src/main/**/*.ts", "src/renderer/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/__fixtures__/**",
        "src/main/index.ts",
        "src/main/updater.ts",
        "src/main/db/**",
        "src/main/ipc/register.ts",
        // Electron / worker glue: exercised by running the app (the logic they wrap is tested).
        "src/main/ipc-guard.ts",
        "src/main/renderer-flush.ts",
        "src/main/databases/puzzle-scan-worker.ts",
        "src/main/repertoire/backup-restore-worker.ts",
        "src/main/ipc/review-handler.ts",
        "src/main/databases/external-databases.ts",
        "src/main/engine/engine-config.ts",
        "src/main/engine/engine-manager.ts",
        "src/main/engine/engine-registry-sync.ts",
        "src/main/engine/probe-eval.ts",
        "src/main/lichess/index.ts",
        "src/main/chesscom/index.ts",
        "src/main/accounts.ts",
        "src/renderer/src/**/use*.ts",
        "src/renderer/src/**/use-*.ts",
        "src/renderer/src/queries/**",
        "src/renderer/src/sounds/**",
        "src/renderer/src/lib/ui.ts",
        "src/renderer/src/lib/utils.ts",
        "src/renderer/src/lib/settings-listbox.ts",
        "src/renderer/src/vite-env.d.ts"
      ],
      // A floor at what the suite reaches today (CI enforces it): raise it as coverage grows,
      // never lower it to let a change through.
      thresholds: {
        lines: 85,
        functions: 77,
        branches: 75,
        statements: 82
      }
    }
  },
  resolve: {
    alias: {
      "@": resolve(appDir, "src/renderer/src"),
      "@chaturanga/shared": resolve(appDir, "../../packages/shared/src")
    }
  }
});
