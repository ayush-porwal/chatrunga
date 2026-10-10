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

/** Drop drawing-neutral attributes and sub-pixel path noise. The board still sizes the piece. */
function compactSvg(svgText) {
  return svgText
    .trim()
    .replace(/ (image-rendering|shape-rendering|text-rendering)="[^"]*"/g, "")
    .replace(/ (width|height)="[^"]*"/g, "")
    .replace(/(\d+\.\d{3,})/g, (n) => String(Math.round(Number(n) * 100) / 100));
}

function themeSvgs(theme) {
  const dir = join(repoRoot, "scripts/piece-svg-sources", theme);
  return FILES.map(([, , fn]) => compactSvg(readFileSync(join(dir, `${fn}.svg`), "utf8")));
}

function buildThemeCss(theme, svgs) {
  return FILES.map(([role, color], index) => {
    return `.cg-wrap.piece-set-${theme} piece.${role}.${color} {\n  background-image: ${toDataUrl(svgs[index])};\n}`;
  }).join("\n\n");
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

const packed = THEMES.map((theme) => themeSvgs(theme));
const body = THEMES.map((theme, index) => buildThemeCss(theme, packed[index])).join("\n\n");
const outPath = join(repoRoot, "apps/desktop/src/renderer/src/styles/generated-piece-themes.css");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${header}${body}\n`, "utf8");
const gzPath = join(repoRoot, "apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz");
writeFileSync(gzPath, gzipSync(Buffer.from(packed.flat().join("\0")), { level: 9 }));
console.log(`Wrote ${outPath} and ${gzPath}`);
