#!/usr/bin/env node
// Sizes of electron-builder output. Used by the throwaway package-size workflow.
// Prints METRIC lines. Exits 1 if a Stockfish binary was packaged.
import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const INSTALLER = /\.(dmg|zip|exe|AppImage)$/i;

/** Installers only: not blockmaps, not the update-feed yml electron-updater reads. */
export function isInstaller(name) {
  return INSTALLER.test(name) && !name.endsWith(".blockmap");
}

/** A packaged Stockfish engine binary, not a fixture, doc, or test name. */
export function isStockfishBinary(name, size) {
  return /stockfish/i.test(name) && size > 1_000_000 && !/\.(txt|md|json|yml)$/i.test(name);
}

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, visit);
    else if (stat.isFile()) visit(path, stat.size);
  }
}

/**
 * Measure `dir` (an electron-builder `dist/`). Returns installer entries and any
 * Stockfish binaries under unpacked app folders.
 */
export function measureDist(dir) {
  const installers = [];
  const stockfish = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (!stat.isFile() || !isInstaller(name)) continue;
    installers.push({ name, bytes: stat.size });
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    walk(path, (file, size) => {
      if (isStockfishBinary(basename(file), size)) stockfish.push(file);
    });
  }
  return { installers, stockfish };
}

function metricName(filename) {
  return filename
    .replace(/^Chaturanga-/, "")
    .replace(/\.(dmg|zip|exe|AppImage)$/i, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: measure-installer-sizes.mjs <dist-dir>");
    process.exit(1);
  }
  const { installers, stockfish } = measureDist(dir);
  if (installers.length === 0) {
    console.error(`no installers in ${dir}`);
    process.exit(1);
  }
  let total = 0;
  for (const installer of installers.sort((a, b) => a.name.localeCompare(b.name))) {
    total += installer.bytes;
    console.log(`METRIC installer_${metricName(installer.name)}_bytes=${installer.bytes}`);
    console.log(`${installer.name}\t${installer.bytes}`);
  }
  console.log(`METRIC installer_bytes=${total}`);
  if (stockfish.length) {
    console.error(`Stockfish binary packaged:\n${stockfish.join("\n")}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("measure-installer-sizes.mjs")) main();
