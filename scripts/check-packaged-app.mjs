#!/usr/bin/env node
// After electron-builder: checks every packaged app in apps/desktop/dist has the files it can't
// start (or run engines/datasets) without — main, preload, renderer and the worker threads —
// plus every chunk and asset those entry points refer to, so a broken package fails the release instead of
// reaching users. What is required comes from the package itself, never from the local out/.
import { createRequire } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// fileURLToPath, not URL.pathname: on Windows that is "/C:/…", not a usable path.
const desktop = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const require = createRequire(join(desktop, "package.json"));
const asar = require("@electron/asar");

/**
 * The worker threads main starts by file path (not imports, so no reference finds them). Each is
 * required: a packaged build without one can't scan puzzle files, preview or store a repertoire
 * import, or restore a repertoire backup (packaged builds never fall back to the main thread).
 */
export const WORKERS = [
  "out/main/puzzle-scan-worker.js",
  "out/main/repertoire-import-worker.js",
  "out/main/repertoire-import-writer-worker.js",
  "out/main/repertoire-backup-restore-worker.js"
];

/** Files every package must contain. */
export const REQUIRED = [
  "out/main/index.js",
  ...WORKERS,
  "out/preload/index.cjs",
  "out/renderer/index.html",
  "package.json"
];

/** Files whose references (code-split chunks, scripts, styles, sounds) must be packaged too. */
const ENTRY_POINTS = [
  "out/main/index.js",
  ...WORKERS,
  "out/preload/index.cjs",
  "out/renderer/index.html"
];

/** Relative module specifiers in a bundle: static/dynamic `import` and `require` of "./…" or "../…". */
export function relativeImports(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.\.?\/[^"']+)["']/g;
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))];
}

/** A reference to a file next to the one that names it (not a URL, data: URI or fragment). */
const isLocal = (reference) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference);

/**
 * The files `source` (at `file`) refers to, by its kind: an HTML page's `src`/`href`; a stylesheet's
 * `url(…)`; a script's imports and `new URL("…", import.meta.url)` assets, plus — in the renderer,
 * where Vite lists a lazy chunk's dependencies as plain strings — every quoted "./….js|css".
 */
export function references(file, source) {
  const found = [];
  const collect = (pattern) => {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  };
  if (file.endsWith(".html")) {
    collect(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g);
  } else if (file.endsWith(".css")) {
    collect(/url\(\s*["']?([^"')]+)["']?\s*\)/g);
  } else {
    found.push(...relativeImports(source));
    collect(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g);
    if (file.startsWith("out/renderer/")) collect(/["'](\.\/[^"'\s]+\.(?:m?js|css))["']/g);
  }
  return [
    ...new Set(
      found
        .map((reference) => reference.split(/[?#]/)[0])
        .filter((reference) => reference && isLocal(reference))
    )
  ];
}

/**
 * What a package is missing, given its file list and a reader for its files: the required files,
 * then (transitively) every file the entry points refer to.
 */
export function missingFiles(files, readFile) {
  const missing = REQUIRED.filter((file) => !files.has(file));
  const seen = new Set();
  const queue = ENTRY_POINTS.filter((file) => files.has(file));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const reference of references(file, readFile(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), reference));
      if (!files.has(target)) {
        if (!missing.includes(target)) missing.push(target);
      } else if (/\.((c|m)?js|css|html)$/.test(target)) {
        queue.push(target);
      }
    }
  }
  return missing;
}

/**
 * A file's path inside an archive as @electron/asar looks it up: split on this OS's separator, so
 * "out/main/index.js" has to be out\main\index.js on Windows (or it is "not found").
 */
export function archivePath(file, separator = sep) {
  return file.split("/").join(separator);
}

/** Checks one app.asar: its file count, and the files it lacks. */
export function checkArchive(archive) {
  const files = new Set(
    asar.listPackage(archive).map((file) => file.replace(/\\/g, "/").replace(/^\//, ""))
  );
  const readFile = (file) => asar.extractFile(archive, archivePath(file)).toString("utf8");
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
