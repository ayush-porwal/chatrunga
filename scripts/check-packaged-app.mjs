#!/usr/bin/env node
// After electron-builder: checks every packaged app in apps/desktop/dist has the files it can't
// start (or run engines/datasets) without — main, preload, renderer and the puzzle-scan worker when
// the build has one — so a broken package fails the release instead of reaching users.
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const desktop = new URL("../apps/desktop/", import.meta.url).pathname;
const require = createRequire(join(desktop, "package.json"));
const asar = require("@electron/asar");

const REQUIRED = ["out/main/index.js", "out/preload/index.cjs", "out/renderer/index.html", "package.json"];

/** Every app.asar under `dir` (unpacked app folders only; installers aren't opened). */
function findArchives(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "app.asar") return [path];
    return statSync(path).isDirectory() && !name.endsWith(".unpacked") ? findArchives(path, depth + 1) : [];
  });
}

const archives = findArchives(join(desktop, "dist"));
if (!archives.length) {
  console.error("No packaged app.asar found under apps/desktop/dist.");
  process.exit(1);
}
let failed = false;
for (const archive of archives) {
  const files = new Set(asar.listPackage(archive).map((file) => file.replace(/\\/g, "/").replace(/^\//, "")));
  const expected = [...REQUIRED];
  if (existsSync(join(desktop, "out/main/puzzle-scan-worker.js"))) expected.push("out/main/puzzle-scan-worker.js");
  const missing = expected.filter((file) => !files.has(file));
  if (missing.length) {
    failed = true;
    console.error(`${archive}: missing ${missing.join(", ")}`);
  } else {
    console.log(`${archive}: ok (${files.size} files)`);
  }
}
process.exit(failed ? 1 : 0);
