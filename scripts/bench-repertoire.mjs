#!/usr/bin/env node
// Runs the repertoire large-collection benchmark (design §11) at full size and prints p50/p95 per
// workload; results go to docs/repertoire-performance.md by hand.
//
//   node scripts/bench-repertoire.mjs [--out results.json]
//
// The benchmark itself is apps/desktop/src/perf/repertoire-perf.test.ts: it imports the shared
// TypeScript modules, the real repository/service over a temporary SQLite database and the
// import parser, which vitest can load without a build step. Without RUN_PERF (as in CI) the same
// file runs at tiny sizes as a smoke test.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? resolve(process.argv[outIndex + 1] ?? "") : "";

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@chaturanga/desktop",
    "exec",
    "vitest",
    "run",
    "src/perf/repertoire-perf.test.ts",
    "--disableConsoleIntercept"
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, RUN_PERF: "1", ...(out ? { PERF_OUT: out } : {}) }
  }
);
process.exit(result.status ?? 1);
