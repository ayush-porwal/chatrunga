#!/usr/bin/env node
// Byte size of the unpacked app electron-builder just wrote, plus a Stockfish guard.
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../apps/desktop/dist/", import.meta.url));

/** Regular files only, each inode once. Framework symlinks would otherwise triple the count. */
function walk(dir, visit, seen = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit, seen);
    else if (entry.isFile()) {
      const stat = statSync(path);
      const id = `${stat.dev}:${stat.ino}`;
      if (seen.has(id)) continue;
      seen.add(id);
      visit(path, stat.size);
    }
  }
}

function sum(dir) {
  let bytes = 0;
  walk(dir, (_path, size) => {
    bytes += size;
  });
  return bytes;
}

const macDir = join(dist, "mac-arm64");
const app = join(macDir, "Chaturanga.app");
if (!statSync(app).isDirectory()) {
  console.error(`missing packaged app: ${app}`);
  process.exit(1);
}

let packageBytes = 0;
let localeBytes = 0;
let asarBytes = 0;
let rendererJs = 0;
let mainJs = 0;
let stockfishBytes = 0;
const stockfishHits = [];

walk(app, (path, size) => {
  packageBytes += size;
  const base = basename(path);
  if (path.includes(".lproj/")) localeBytes += size;
  if (base === "app.asar") asarBytes = size;
  // A Stockfish binary is large and named stockfish. Docs and fixtures are not.
  if (/stockfish/i.test(base) && size > 1_000_000 && !/\.(txt|md|json)$/i.test(base)) {
    stockfishBytes += size;
    stockfishHits.push(path);
  }
});

// JS lives inside app.asar, so count the build output the asar was packed from.
const outDir = fileURLToPath(new URL("../apps/desktop/out/", import.meta.url));
walk(outDir, (path, size) => {
  if (!path.endsWith(".js") && !path.endsWith(".cjs")) return;
  if (path.includes(`${join("out", "renderer")}`) || path.includes("/renderer/"))
    rendererJs += size;
  else if (path.includes("/main/")) mainJs += size;
});

const zips = readdirSync(dist).filter((name) => name.endsWith("-arm64.zip"));
const zipBytes = zips.reduce((total, name) => total + statSync(join(dist, name)).size, 0);

let marketingBytes = 0;
const marketing = fileURLToPath(new URL("../apps/marketing/dist/", import.meta.url));
try {
  marketingBytes = sum(marketing);
} catch {
  marketingBytes = 0;
}

console.log(`METRIC package_bytes=${packageBytes}`);
console.log(`METRIC zip_bytes=${zipBytes}`);
console.log(`METRIC locale_bytes=${localeBytes}`);
console.log(`METRIC asar_bytes=${asarBytes}`);
console.log(`METRIC renderer_js_bytes=${rendererJs}`);
console.log(`METRIC main_js_bytes=${mainJs}`);
console.log(`METRIC stockfish_bytes=${stockfishBytes}`);
console.log(`METRIC marketing_bytes=${marketingBytes}`);

if (stockfishBytes > 0) {
  console.error(`Stockfish binary packaged:\n${stockfishHits.join("\n")}`);
  process.exit(1);
}
