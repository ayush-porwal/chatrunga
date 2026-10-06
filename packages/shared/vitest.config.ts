import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Locally, half the cores: a full run leaves the machine usable. CI keeps them all.
    maxWorkers: process.env.CI ? undefined : "50%",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/chess/**/*.ts", "src/engine/**/*.ts", "src/llm/**/*.ts", "src/ipc/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    }
  }
});
