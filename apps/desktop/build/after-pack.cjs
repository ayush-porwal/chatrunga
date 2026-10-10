const { readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");

const CRASHPAD = new Set(["chrome_crashpad_handler", "chrome_crashpad_handler.exe"]);
const DEAD_MARKERS = [
  Buffer.from("about_tracing"),
  Buffer.from("chrome://tracing"),
  Buffer.from("d3js.org"),
  Buffer.from("lottiejs")
];

function walk(dir, hits, names) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, hits, names);
    else if (names.has(entry.name)) hits.push(full);
  }
}

function walkDirs(dir, hits, suffix) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.endsWith(suffix)) hits.push(full);
    else walkDirs(full, hits, suffix);
  }
}

/**
 * Chromium web-ui extras this app never shows: the about:tracing debug page (script, html,
 * its d3 copy), the whats-new animation library, and the whats-new banner art. Gzip resources
 * are matched by payload markers; PNGs only by exact IHDR dimensions pinned to the observed
 * whats-new art, so a different large image in a future Electron cannot be silently dropped —
 * the strip would simply stop matching and lose the savings instead.
 *
 * Pak v5 header: uint32 version, uint8 encoding, 3 pad bytes, uint16 resource count, uint16 alias count.
 */
const DEAD_PNG_SHAPES = new Set([
  "1537x669", // whats-new banner, 1x
  "768x334", // whats-new banner, 2x
  "1224x300", // whats-new wordmark banner
  "404x34" // Google Developer Program wordmark
]);

function isDeadPng(blob) {
  if (
    blob.length < 24 ||
    blob[0] !== 0x89 ||
    blob[1] !== 0x50 ||
    blob[12] !== 0x49 ||
    blob[13] !== 0x48
  ) {
    return false;
  }
  if (blob[14] !== 0x44 || blob[15] !== 0x52) return false;
  return DEAD_PNG_SHAPES.has(`${blob.readUInt32BE(16)}x${blob.readUInt32BE(20)}`);
}

function stripDeadPakResources(file) {
  const data = readFileSync(file);
  if (data.length < 12 || data.readUInt32LE(0) !== 5) return false;
  const resourceCount = data.readUInt16LE(8);
  const aliasCount = data.readUInt16LE(10);
  const dataStart = 12 + (resourceCount + 1) * 6 + aliasCount * 4;
  if (dataStart > data.length) return false;
  const entries = [];
  for (let i = 0; i <= resourceCount; i++) {
    const at = 12 + i * 6;
    entries.push([data.readUInt16LE(at), data.readUInt32LE(at + 2)]);
  }
  if (entries[0][1] !== dataStart) return false;
  const targets = new Set();
  for (let i = 0; i < resourceCount; i++) {
    const start = entries[i][1];
    const end = entries[i + 1][1];
    if (end <= start || end > data.length) continue;
    const blob = data.subarray(start, end);
    if (blob[0] === 0x1f && blob[1] === 0x8b) {
      let text;
      try {
        text = gunzipSync(blob);
      } catch {
        continue;
      }
      if (DEAD_MARKERS.some((marker) => text.includes(marker))) targets.add(i);
    } else if (isDeadPng(blob)) {
      targets.add(i);
    }
  }
  if (targets.size === 0) return false;
  const blobs = [];
  let cursor = dataStart;
  const table = Buffer.from(data.subarray(0, dataStart));
  for (let i = 0; i < resourceCount; i++) {
    table.writeUInt32LE(cursor, 14 + i * 6);
    const blob = targets.has(i) ? Buffer.alloc(0) : data.subarray(entries[i][1], entries[i + 1][1]);
    blobs.push(blob);
    cursor += blob.length;
  }
  table.writeUInt32LE(cursor, 14 + resourceCount * 6);
  writeFileSync(file, Buffer.concat([table, ...blobs]));
  return true;
}

/** The app does not use crashReporter. The handler is only spawned for Chromium crash dumps. */
module.exports = async function afterPack(context) {
  const crashpad = [];
  walk(context.appOutDir, crashpad, CRASHPAD);
  for (const file of crashpad) rmSync(file, { force: true });
  const paks = [];
  walk(context.appOutDir, paks, new Set(["resources.pak"]));
  for (const file of paks) stripDeadPakResources(file);
  // Electron 42 dropped PPAPI plugin support entirely, so the Plugin helper has no runtime
  // trigger (its only spawn path is a Pepper plugin). Restore it if a plugin ever comes back.
  const pluginHelpers = [];
  walkDirs(context.appOutDir, pluginHelpers, "Helper (Plugin).app");
  for (const dir of pluginHelpers) rmSync(dir, { recursive: true, force: true });
};
