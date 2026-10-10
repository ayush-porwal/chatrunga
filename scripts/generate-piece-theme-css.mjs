#!/usr/bin/env node
/**
 * Builds scoped Chessground-compatible piece CSS from SVG files vendored under
 * scripts/piece-svg-sources/<theme>/ (same filenames as lichess-org/lila public/piece).
 *
 * Output: apps/desktop/src/renderer/src/styles/generated-piece-themes.css
 *
 * Selectors use `.cg-wrap.piece-set-<theme>` so they override the default
 * `chessground.cburnett.css` rules without conflicting across themes.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const THEMES = [
  "merida",
  "alpha",
  "california",
  "cardinal",
  "chessnut",
  "kosal",
  "maestro",
  "pirouetti"
];

const FILES = [
  ["pawn", "white", "wP"],
  ["knight", "white", "wN"],
  ["bishop", "white", "wB"],
  ["rook", "white", "wR"],
  ["queen", "white", "wQ"],
  ["king", "white", "wK"],
  ["pawn", "black", "bP"],
  ["knight", "black", "bN"],
  ["bishop", "black", "bB"],
  ["rook", "black", "bR"],
  ["queen", "black", "bQ"],
  ["king", "black", "bK"]
];

/** Percent-encode only characters that would break a CSS url(). Smaller than base64. */
function toDataUrl(svgText) {
  const compact = svgText
    .trim()
    .replace(/\s+/g, " ")
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/"/g, "'")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/ /g, "%20");
  return `url("data:image/svg+xml,${compact}")`;
}

function buildThemeCss(theme) {
  const dir = join(repoRoot, "scripts/piece-svg-sources", theme);
  const rules = [];
  for (const [role, color, fn] of FILES) {
    const path = join(dir, `${fn}.svg`);
    const svg = readFileSync(path, "utf8");
    rules.push(
      `.cg-wrap.piece-set-${theme} piece.${role}.${color} {\n  background-image: ${toDataUrl(svg)};\n}`
    );
  }
  return rules.join("\n\n");
}

const header = `/**
 * AUTO-GENERATED — do not edit by hand.
 * Regenerate: node scripts/generate-piece-theme-css.mjs
 *
 * Piece SVG sources: scripts/piece-svg-sources/<theme>/ (from lichess-org/lila
 * https://github.com/lichess-org/lila/tree/master/public/piece — AGPL-3.0).
 * Individual sets may carry additional credits in upstream Lichess docs.
 */

`;

const body = THEMES.map((t) => buildThemeCss(t)).join("\n\n");
const outPath = join(repoRoot, "apps/desktop/src/renderer/src/styles/generated-piece-themes.css");
mkdirSync(dirname(outPath), { recursive: true });
const css = `${header}${body}\n`;
writeFileSync(outPath, css, "utf8");
const gzPath = join(
  repoRoot,
  "apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz"
);
writeFileSync(gzPath, gzipSync(Buffer.from(css), { level: 9 }));
console.log(`Wrote ${outPath} and ${gzPath}`);
