// Pre-flight for `pnpm dev:desktop`: fail fast with a useful message when the Electron
// binary was not downloaded (e.g. its postinstall was skipped).
const { existsSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join } = require("node:path");

const requireFromDesktop = createRequire(join(__dirname, "..", "apps", "desktop", "package.json"));

let electronPath;
try {
  electronPath = requireFromDesktop("electron");
} catch (error) {
  console.error("Electron is not installed correctly.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (typeof electronPath !== "string" || !existsSync(electronPath)) {
  console.error("Electron binary is missing.");
  console.error("Run `pnpm rebuild electron` or `pnpm install` before starting the desktop app.");
  process.exit(1);
}
