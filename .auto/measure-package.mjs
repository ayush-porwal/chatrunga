#!/usr/bin/env node
// Byte size of the unpacked app electron-builder just wrote, plus a Stockfish guard.
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const dist = new URL("../apps/desktop/dist/", import.meta.url);

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, visit);
    else if (stat.isFile()) visit(path, stat.size);
  }
}

function sum(dir) {
  let bytes = 0;
  walk(dir, (_path, size) => {
    bytes += size;
  });
  return bytes;
}

const macDir = join(dist.pathname, "mac-arm64");
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
  if (path.endsWith(".lproj") || path.includes(".lproj/")) localeBytes += size;
  if (base === "app.asar") asarBytes = size;
  if (path.includes("/app.asar.unpacked/")) {
    /* unpacked payload counted in packageBytes already */
  }
  if (/\/out\/renderer\/.*\.js$/.test(path) || /\/renderer\/assets\/.*\.js$/.test(path)) {
    rendererJs += size;
  }
  if (/\/out\/main\/.*\.js$/.test(path)) mainJs += size;
  // A Stockfish binary is large and named stockfish. Docs and fixtures are not.
  if (/stockfish/i.test(base) && size > 1_000_000) {
    stockfishBytes += size;
    stockfishHits.push(path);
  }
});

const zips = readdirSync(dist.pathname).filter((name) => name.endsWith("-arm64.zip"));
const zipBytes = zips.reduce((total, name) => total + statSync(join(dist.pathname, name)).size, 0);

let marketingBytes = 0;
const marketing = new URL("../apps/marketing/dist/", import.meta.url);
try {
  marketingBytes = sum(marketing.pathname);
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
