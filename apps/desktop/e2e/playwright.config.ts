// Electron smoke journeys (e2e/*.spec.ts) against the built app. Not part of the PR checks: they
// run nightly (.github/workflows/e2e.yml) and against each packaged release build (release.yml).
//
//   pnpm --filter @chaturanga/desktop test:e2e         build, then run against out/ on node_modules' Electron
//   pnpm --filter @chaturanga/desktop test:e2e:run     run only (out/ already built)
//   CHATURANGA_E2E_PACKAGED=1 pnpm --filter @chaturanga/desktop test:e2e:run
//                                                      against the unpacked app electron-builder left in dist/
//   CHATURANGA_E2E_EXECUTABLE=<path>                   against that executable
//
// Each test gets a throwaway profile (CHATURANGA_USER_DATA_DIR); network, analytics, updates and
// native dialogs are disabled or stubbed (see app.ts). Linux needs a display: run under xvfb-run.
import { defineConfig } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results/e2e",
  // One app at a time: windows don't fight over focus and slow CI machines aren't overloaded.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  reporter: ci
    ? [["list"], ["html", { outputFolder: "../test-results/e2e-report", open: "never" }]]
    : "list"
});
