const { readdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const CRASHPAD = new Set(["chrome_crashpad_handler", "chrome_crashpad_handler.exe"]);

function walk(dir, hits) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, hits);
    else if (CRASHPAD.has(entry.name)) hits.push(full);
  }
}

/** The app does not use crashReporter. The handler is only spawned for Chromium crash dumps. */
module.exports = async function afterPack(context) {
  const hits = [];
  walk(context.appOutDir, hits);
  for (const file of hits) rmSync(file, { force: true });
};
