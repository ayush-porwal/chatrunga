import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/main/engine/bundled-engines.ts",
        "src/main/engine/review-search.ts",
        "src/main/engine/uci.ts",
        "src/renderer/src/features/analysis/engine-game-helpers.ts",
        "src/renderer/src/ipc/**/*.ts",
        "src/renderer/src/lib/**/*.ts",
        "src/renderer/src/stores/**/*.ts"
      ],
      exclude: ["**/*.test.ts", "**/*.test.tsx"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 60,
        statements: 80
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
