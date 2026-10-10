#!/usr/bin/env node
/**
 * Packs the piece SVGs in scripts/piece-svg-sources/<theme>/ (our copies; see its README) into the
 * gzip the renderer inflates before first paint:
 * apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz.
 *
 * generated-piece-themes.ts turns a set's SVGs into scoped `.cg-wrap.piece-set-<theme>` rules the
 * first time something shows that set, so they override the default `chessground.cburnett.css`
 * without conflicting across themes. No stylesheet is emitted here.
 *
 * Each drawing is finished on the way in, so every set sits on the board the same way:
 * - fit: a square viewBox from fit.json (see measure-piece-fit.mjs) per size mode, which sizes
 *   every piece to its mode's height, stands it on one floor and centres it;
 * - finish: drop shadows baked into a drawing go (the board is flat).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
export const sourcesDir = join(repoRoot, "scripts/piece-svg-sources");

export const THEMES = [
  "cburnett",
  "merida",
  "california",
  "cardinal",
  "chessnut",
  "kosal",
  "maestro",
  "pirouetti",
  "classic",
  "anarcandy",
  "caliente",
  "celtic",
  "cooke",
  "disguised",
  "dubrovny",
  "fantasy",
  "firi",
  "fresca",
  "gioco",
  "horsey",
  "icpieces",
  "kiwen-suwi",
  "letter",
  "minimal-warmth",
  "mpchess",
  "papercut",
  "pixel",
  "rhosgfx",
  "shapes",
  "spatial",
  "staunty",
  "tatiana",
  "totoy",
  "xkcd"
];

/**
 * Piece size modes (Settings → Board → Piece sizes), each a fit in fit.json: `ladder` ranks pieces
 * by height (king tallest, pawn shortest), `uniform` makes every piece as tall as the king.
 */
export const HEIGHTS = ["ladder", "uniform"];

export const FILES = [
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

/** Round a coordinate run to `decimals` places. */
function roundNumbers(text, decimals) {
  const scale = 10 ** decimals;
  const long = new RegExp(`(?<![\\d.])(\\d+\\.\\d{${decimals + 1},})`, "g");
  return text.replace(long, (n, _, offset, run) => {
    const rounded = String(Math.round(Number(n) * scale) / scale);
    // Path data packs numbers as `2.63.0024` (2.63, then .0024): a match only starts a number,
    // and a whole result keeps a separator, or the next number merges into it (`1.998.006`
    // must not become `2.006`).
    return run[offset + n.length] === "." && !rounded.includes(".") ? `${rounded} ` : rounded;
  });
}

/**
 * Decimal places that keep rounding under 1/500000 of the drawing (3 at least). Path data is often
 * relative, so each point's rounding error carries into the next: coarser rounding visibly warped
 * long outlines (Tatiana's queen, Firi's king), and a set drawn in a 10-unit box (MPChess) needs 5.
 * measure-piece-fit.mjs fails if packing changes a single pixel of any drawing.
 */
function decimalsFor(svgText) {
  const box = svgText
    .match(/^<svg[^>]* viewBox="([^"]+)"/)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const size = box ? Math.max(box[2], box[3]) : 0;
  return size > 0 ? Math.max(3, Math.ceil(Math.log10(500000 / size))) : 3;
}

/** Drop drawing-neutral attributes and sub-pixel path noise. The board still sizes the piece. */
export function compactSvg(svgText) {
  const boxed = svgText
    .trim()
    .replace(/ (image-rendering|shape-rendering|text-rendering)="[^"]*"/g, "")
    // The published files mark their root `color-scheme:light only`; an image never takes the
    // page's scheme, so it does nothing here.
    .replace(/^<svg[^>]*>/, (tag) => tag.replace(/ style="color-scheme:light only"/, ""))
    // Only the root's size goes (the board sizes the piece); filters and masks keep their regions.
    // A drawing sized only by width/height keeps that box as its viewBox.
    .replace(/^<svg[^>]*>/, (tag) => {
      const [w, h] = ["width", "height"].map((a) => tag.match(new RegExp(` ${a}="([\\d.]+)`))?.[1]);
      const withBox =
        /\sviewBox=/.test(tag) || !w || !h
          ? tag
          : tag.replace(/^<svg/, `<svg viewBox="0 0 ${w} ${h}"`);
      return withBox.replace(/ (width|height)="[^"]*"/g, "");
    });
  const decimals = decimalsFor(boxed);
  // Transforms keep full precision: a matrix scale of 1.0008 rounded to 1 moves far-off
  // coordinates by a visible fraction of the piece.
  return boxed
    .split(/( [a-zA-Z]*[tT]ransform="[^"]*")/)
    .map((part, i) => (i % 2 ? part : roundNumbers(part, decimals)))
    .join("");
}

/** Swap the root viewBox for the fitted square one (sizing attributes are already gone). */
export function fitSvg(svgText, viewBox) {
  return svgText.replace(/^<svg[^>]*>/, (tag) => {
    const bare = tag.replace(/ viewBox="[^"]*"/, "");
    return bare.replace(/^<svg/, `<svg viewBox="${viewBox}"`);
  });
}

/**
 * Detaches every filter that offsets its result — a baked-in drop shadow — whether a shape names
 * it in a `filter` attribute or in its inline style (Papercut).
 */
export function dropBakedShadows(svgText) {
  const shadowIds = [...svgText.matchAll(/<filter\b([^>]*)>((?:(?!<\/filter>).)*)<\/filter>/gs)]
    .filter(([, , body]) => body.includes("<feOffset"))
    .map(([, attributes]) => attributes.match(/\sid="([^"]+)"/)?.[1])
    .filter(Boolean);
  return shadowIds.reduce((svg, id) => {
    const ref = `url\\(#${escapeRegExp(id)}\\)`;
    return svg
      .replace(new RegExp(` filter="${ref}"`, "g"), "")
      .replace(new RegExp(`filter:\\s*${ref};?`, "g"), "");
  }, svgText);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The drawing as it stands on the board, before fitting: baked shadows gone. */
export function finishSvg(svgText) {
  return dropBakedShadows(svgText);
}

export function loadFit() {
  return JSON.parse(readFileSync(join(sourcesDir, "fit.json"), "utf8"));
}

export function prepareSvg(theme, file, fit = loadFit(), heights = "ladder") {
  const raw = readFileSync(join(sourcesDir, theme, `${file}.svg`), "utf8");
  const viewBox = fit[heights]?.[theme]?.[file];
  if (!viewBox) throw new Error(`fit.json has no ${heights} viewBox for ${theme}/${file}`);
  return fitSvg(finishSvg(compactSvg(raw)), viewBox);
}

export const payloadPath = join(
  repoRoot,
  "apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz"
);

/**
 * The text the renderer inflates (generated-piece-themes.ts reads it), NUL-separated: the set
 * names, space-separated; every set's drawings at ranked sizes; then every drawing's uniform
 * viewBox, which the renderer swaps in for the uniform rules.
 */
export function packedPayload(fit = loadFit()) {
  const drawings = THEMES.flatMap((theme) =>
    FILES.map(([, , fn]) => prepareSvg(theme, fn, fit, "ladder"))
  );
  const uniform = THEMES.flatMap((theme) => FILES.map(([, , fn]) => fit.uniform[theme][fn]));
  return [THEMES.join(" "), ...drawings, ...uniform].join("\0");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(payloadPath, gzipSync(Buffer.from(packedPayload()), { level: 9 }));
  console.log(`Wrote ${payloadPath}`);
}
