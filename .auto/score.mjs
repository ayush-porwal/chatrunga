#!/usr/bin/env node
// Combines package, lighthouse, and dead-code metrics into the primary score.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function readMetrics(file) {
  const text = readFileSync(file, "utf8");
  const metrics = {};
  for (const match of text.matchAll(/^METRIC\s+([a-z0-9_]+)=(\d+)/gm)) {
    metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

function walk(dir, visit) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === "dist" || name.name === "out" || name.name === "coverage") {
      continue;
    }
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, visit);
    else visit(path);
  }
}

const imageExt = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".icns"]);
const textExt = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".json", ".md"]);
const images = [];
const texts = [];
for (const top of ["apps", "packages", "scripts"]) {
  walk(join(root, top), (path) => {
    const ext = path.slice(path.lastIndexOf("."));
    if (imageExt.has(ext)) images.push(path);
    else if (textExt.has(ext)) texts.push(path);
  });
}
const corpus = texts.map((path) => readFileSync(path, "utf8")).join("\n");
// piece-svg-sources are generator inputs, walked by directory in
// scripts/generate-piece-theme-css.mjs, so their basenames never appear in text.
const pieceSources = `${join("scripts", "piece-svg-sources")}/`;
const unreferenced = images.filter(
  (path) => !path.includes(pieceSources) && !corpus.includes(basename(path))
);
console.log(`METRIC unreferenced_images=${unreferenced.length}`);
if (unreferenced.length) {
  console.error(`unreferenced images:\n${unreferenced.map((path) => path.slice(root.length)).join("\n")}`);
}

const pkg = readMetrics("/tmp/chaturanga-package-metrics.txt");
const lh = readMetrics("/tmp/chaturanga-lh-metrics.txt");
const knip = readMetrics("/tmp/chaturanga-knip-metrics.txt");
for (const key of ["package_bytes", "lh_perf", "lh_a11y", "lh_bp", "lh_seo", "knip_issues"]) {
  if (pkg[key] === undefined && lh[key] === undefined && knip[key] === undefined) {
    console.error(`missing metric ${key}`);
    process.exit(1);
  }
}
if ((lh.lh_pages ?? 0) < 6) {
  console.error(`expected 6 packaged-app lighthouse pages, got ${lh.lh_pages ?? 0}`);
  process.exit(1);
}
const sizeBytes = pkg.package_bytes;
const lhDeficit = 400 - (lh.lh_perf + lh.lh_a11y + lh.lh_bp + lh.lh_seo);
const deadUnits = Math.min(999, knip.knip_issues + unreferenced.length);
const score = Math.floor(sizeBytes / 100) * 1_000_000 + lhDeficit * 1_000 + deadUnits;
console.log(`METRIC score=${score}`);
