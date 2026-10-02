#!/usr/bin/env node
// After electron-builder: checks every packaged app in apps/desktop/dist has the files it can't
// start (or run engines/datasets) without — main, preload, renderer and the puzzle-scan worker —
// plus every chunk those entry points import, so a broken package fails the release instead of
// reaching users. What is required comes from the package itself, never from the local out/.
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// fileURLToPath, not URL.pathname: on Windows that is "/C:/…", not a usable path.
const desktop = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const require = createRequire(join(desktop, "package.json"));
const asar = require("@electron/asar");

/** Files every package must contain. The worker is required: a build without it can't scan puzzle files off the main thread. */
export const REQUIRED = [
  "out/main/index.js",
  "out/main/puzzle-scan-worker.js",
  "out/preload/index.cjs",
  "out/renderer/index.html",
  "package.json"
];

/** Bundles whose relative imports (code-split chunks) must be packaged too. */
const ENTRY_POINTS = [
  "out/main/index.js",
  "out/main/puzzle-scan-worker.js",
  "out/preload/index.cjs"
];

/** Relative module specifiers in a bundle: static/dynamic `import` and `require` of "./…" or "../…". */
export function relativeImports(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.\.?\/[^"']+)["']/g;
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))];
}

/**
 * What a package is missing, given its file list and a reader for its files: the required files,
 * then (transitively) every chunk the entry points import.
 */
export function missingFiles(files, readFile) {
  const missing = REQUIRED.filter((file) => !files.has(file));
  const seen = new Set();
  const queue = ENTRY_POINTS.filter((file) => files.has(file));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of relativeImports(readFile(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!files.has(target)) {
        if (!missing.includes(target)) missing.push(target);
      } else if (/\.(c|m)?js$/.test(target)) {
        queue.push(target);
      }
    }
  }
  return missing;
}

/** Checks one app.asar: its file count, and the files it lacks. */
export function checkArchive(archive) {
  const files = new Set(
    asar.listPackage(archive).map((file) => file.replace(/\\/g, "/").replace(/^\//, ""))
  );
  const readFile = (file) => asar.extractFile(archive, file).toString("utf8");
  return { fileCount: files.size, missing: missingFiles(files, readFile) };
}

/** Every app.asar under `dir` (unpacked app folders only; installers aren't opened). */
export function findArchives(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "app.asar") return [path];
    return statSync(path).isDirectory() && !name.endsWith(".unpacked")
      ? findArchives(path, depth + 1)
      : [];
  });
}

/** Checks every package under `distDir`; true when all are complete. */
export function checkDist(distDir, log = console) {
  const archives = findArchives(distDir);
  if (!archives.length) {
    log.error(`No packaged app.asar found under ${distDir}.`);
    return false;
  }
  let ok = true;
  for (const archive of archives) {
    const { fileCount, missing } = checkArchive(archive);
    if (missing.length) {
      ok = false;
      log.error(`${archive}: missing ${missing.join(", ")}`);
    } else {
      log.log(`${archive}: ok (${fileCount} files)`);
    }
  }
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(checkDist(join(desktop, "dist")) ? 0 : 1);
}
