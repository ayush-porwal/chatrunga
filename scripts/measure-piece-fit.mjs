#!/usr/bin/env node
/**
 * Measures where every piece drawing actually paints (rasterised in Chromium, strokes included)
 * and writes scripts/piece-svg-sources/fit.json: for each size mode, one square viewBox per
 * drawing, which generate-piece-theme-css.mjs swaps in. Run it after changing or adding a set:
 *
 *   node scripts/measure-piece-fit.mjs && pnpm generate:piece-css
 *
 * Each piece is scaled to its mode's height (LADDER by rank, or every piece as tall as the king),
 * less if its wider colour would pass MAX_WIDTH; black takes white's height, so a pair matches.
 * Every piece stands FLOOR above the square's bottom edge with its ink centred. Some sets are drawn
 * in non-square viewBoxes, which the board's `background-size: cover` crops; the fitted box is
 * always square. Compaction is checked here too: it must not change a drawing's pixels.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  compactSvg,
  FILES,
  finishSvg,
  HEIGHTS,
  sourcesDir,
  THEMES
} from "./generate-piece-theme-css.mjs";

const KING_HEIGHT = 0.8;
/** Heights by rank, as a fraction of the square: king tallest, pawn shortest. */
const LADDER = { K: 0.8, Q: 0.78, R: 0.76, B: 0.74, N: 0.74, P: 0.7 };
/** Sets drawing every piece alike (blindfold practice): ranked heights would tell them apart. */
const ALWAYS_EVEN = new Set(["disguised"]);
const MAX_WIDTH = 0.9;
const FLOOR = 0.09;
/** Raster size for measuring; ink is any pixel at least ~10% opaque. */
const RASTER = 1024;
const ALPHA_MIN = 24;

const require = createRequire(join(sourcesDir, "../../apps/desktop/package.json"));
const { chromium } = require("@playwright/test");

function viewBoxOf(svg) {
  const vb = svg.match(/^<svg[^>]* viewBox="([^"]+)"/);
  if (!vb) throw new Error("drawing has no viewBox");
  return vb[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
}

/** Renders `svg` square over `box` (its own units) as a data URL Chromium can rasterise. */
function framed(svg, box) {
  const tag = svg
    .match(/^<svg[^>]*>/)[0]
    .replace(/ (viewBox|width|height)="[^"]*"/g, "")
    .replace(/^<svg/, `<svg width="${RASTER}" height="${RASTER}" viewBox="${box.join(" ")}"`);
  return `data:image/svg+xml,${encodeURIComponent(tag + svg.slice(svg.indexOf(">") + 1))}`;
}

/**
 * Ink bounds of the finished drawing (as it stands on the board) in its own units, measured over a
 * box padded past its viewBox. The raw and compacted drawings are rendered alongside: compaction
 * must not visibly change a single pixel (coverage off by more than 96/255), or it has corrupted
 * the drawing.
 */
async function inkBounds(page, raw, compact, finished) {
  const [x, y, w, h] = viewBoxOf(compact);
  const side = Math.max(w, h) * 1.5;
  const box = [x + w / 2 - side / 2, y + h / 2 - side / 2, side, side];
  const px = await page.evaluate(
    async ({ srcs, size, alphaMin }) => {
      // Runs in the page: its DOM globals, not Node's.
      const { Image, OffscreenCanvas } = globalThis;
      const alphas = [];
      for (const src of srcs) {
        const img = new Image();
        img.src = src;
        await img.decode();
        const ctx = new OffscreenCanvas(size, size).getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        alphas.push(ctx.getImageData(0, 0, size, size).data);
      }
      const [compactData, rawData, data] = alphas;
      let top = size,
        bottom = -1,
        left = size,
        right = -1,
        changed = 0;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const i = (row * size + col) * 4;
          if (Math.abs(compactData[i + 3] - rawData[i + 3]) > 96) changed++;
          if (data[i + 3] < alphaMin) continue;
          if (row < top) top = row;
          if (row > bottom) bottom = row;
          if (col < left) left = col;
          if (col > right) right = col;
        }
      }
      return { top, bottom: bottom + 1, left, right: right + 1, changed };
    },
    {
      srcs: [framed(compact, box), framed(raw, box), framed(finished, box)],
      size: RASTER,
      alphaMin: ALPHA_MIN
    }
  );
  if (px.bottom <= px.top) throw new Error("drawing paints nothing");
  if (px.changed > 0) {
    throw new Error(`compaction changed ${px.changed} pixels`);
  }
  const unit = side / RASTER;
  return {
    x0: box[0] + px.left * unit,
    x1: box[0] + px.right * unit,
    y0: box[1] + px.top * unit,
    y1: box[1] + px.bottom * unit
  };
}

const round = (n) => Math.round(n * 100) / 100;

/** Playwright's own Chromium when installed, else the system Chrome: any Chromium measures alike. */
async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: "chrome" });
  }
}

/** Piece kind of a file name: `wQ` → `Q`. */
const kind = (file) => file.slice(1);

/**
 * Target ink height (fraction of the square) for each piece kind.
 * - ladder: one ladder for every set;
 * - uniform: every piece as tall as the king.
 * Black pieces always take their white partner's height, so a pair is the same size.
 */
function targetHeights(bounds, heights) {
  const h = (file) => bounds[file].y1 - bounds[file].y0;
  const w = (file) => bounds[file].x1 - bounds[file].x0;
  const kinds = [...new Set(FILES.map(([, , file]) => kind(file)))];
  const target =
    heights === "ladder" ? LADDER : Object.fromEntries(kinds.map((k) => [k, KING_HEIGHT]));
  // Shrink a kind whose wider colour would pass MAX_WIDTH at its target height.
  return Object.fromEntries(
    kinds.map((k) => {
      const aspect = Math.max(w(`w${k}`) / h(`w${k}`), w(`b${k}`) / h(`b${k}`));
      return [k, Math.min(target[k], MAX_WIDTH / aspect)];
    })
  );
}

const browser = await launch();
try {
  const page = await browser.newPage();
  const fit = Object.fromEntries(HEIGHTS.map((heights) => [heights, {}]));
  for (const theme of THEMES) {
    const bounds = {};
    for (const [, , file] of FILES) {
      const raw = readFileSync(join(sourcesDir, theme, `${file}.svg`), "utf8").trim();
      try {
        const compact = compactSvg(raw);
        bounds[file] = await inkBounds(page, raw, compact, finishSvg(compact));
      } catch (error) {
        throw new Error(`${theme}/${file}: ${error.message}`, { cause: error });
      }
    }
    for (const heights of HEIGHTS) {
      const targets = targetHeights(bounds, ALWAYS_EVEN.has(theme) ? "uniform" : heights);
      fit[heights][theme] = {};
      for (const [, , file] of FILES) {
        const b = bounds[file];
        const side = (b.y1 - b.y0) / targets[kind(file)];
        const x = (b.x0 + b.x1) / 2 - side / 2;
        const y = b.y1 - (1 - FLOOR) * side;
        fit[heights][theme][file] = [x, y, side, side].map(round).join(" ");
      }
    }
  }
  const out = join(sourcesDir, "fit.json");
  writeFileSync(out, `${JSON.stringify(fit, null, 2)}\n`);
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
