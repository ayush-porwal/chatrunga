const { readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");

const CRASHPAD = new Set(["chrome_crashpad_handler", "chrome_crashpad_handler.exe"]);
const TRACING_MARKER = Buffer.from("about_tracing");

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

/**
 * about:tracing is a Chromium debug page this app never opens. Its script is one gzip
 * resource in resources.pak. Drop it only when the payload is that page, so a shifted id
 * cannot delete something else.
 *
 * Pak v5 header: uint32 version, uint8 encoding, 3 pad bytes, uint16 resource count, uint16 alias count.
 */
function stripTracingResource(file) {
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
  let target = -1;
  for (let i = 0; i < resourceCount; i++) {
    const start = entries[i][1];
    const end = entries[i + 1][1];
    if (end <= start || end > data.length || data[start] !== 0x1f || data[start + 1] !== 0x8b) continue;
    let text;
    try {
      text = gunzipSync(data.subarray(start, end));
    } catch {
      continue;
    }
    if (text.includes(TRACING_MARKER)) {
      target = i;
      break;
    }
  }
  if (target < 0) return false;
  const blobs = [];
  let cursor = dataStart;
  const table = Buffer.from(data.subarray(0, dataStart));
  for (let i = 0; i < resourceCount; i++) {
    table.writeUInt32LE(cursor, 14 + i * 6);
    const blob = i === target ? Buffer.alloc(0) : data.subarray(entries[i][1], entries[i + 1][1]);
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
  for (const file of paks) stripTracingResource(file);
};
