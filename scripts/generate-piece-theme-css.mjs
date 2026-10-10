#!/usr/bin/env node
/**
 * Packs the vendored piece SVGs (scripts/piece-svg-sources/<theme>/, same filenames as
 * lichess-org/lila public/piece) into the gzip the renderer inflates before first paint:
 * apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz.
 *
 * generated-piece-themes.ts turns those SVGs into scoped `.cg-wrap.piece-set-<theme>` rules at
 * startup, so they override the default `chessground.cburnett.css` without conflicting across
 * themes. No stylesheet is emitted here — the CSS is built at runtime from this exact payload.
 */

import { readFileSync, writeFileSync } from "node:fs";
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

const gzPath = join(repoRoot, "apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz");
const packed = THEMES.map((theme) => themeSvgs(theme));
writeFileSync(gzPath, gzipSync(Buffer.from(packed.flat().join("\0")), { level: 9 }));
console.log(`Wrote ${gzPath}`);
