// The piece drawings ship as compact SVG text (scripts/generate-piece-theme-css.mjs), inflated once
// and wrapped as CSS one piece set at a time, when something on screen first shows that set.
import { useEffect } from "react";
import { isPieceStyle, type PieceStyle } from "@chaturanga/shared/types/settings";
import gzUrl from "./generated-piece-themes.css.gz?url";

/** The generator's piece order within each set. */
const PIECES = [
  ["pawn", "white"],
  ["knight", "white"],
  ["bishop", "white"],
  ["rook", "white"],
  ["queen", "white"],
  ["king", "white"],
  ["pawn", "black"],
  ["knight", "black"],
  ["bishop", "black"],
  ["rook", "black"],
  ["queen", "black"],
  ["king", "black"]
] as const;

/** A set's twelve drawings at ranked sizes, and the same drawings at uniform sizes. */
export type PieceSetDrawings = { ladder: string[]; uniform: string[] };

/**
 * Reads the inflated payload: the set names (space-separated), then every set's drawings, then
 * every set's uniform viewBox, all NUL-separated. Throws when it doesn't hold together.
 */
export function parsePieceDrawings(text: string): Map<PieceStyle, PieceSetDrawings> {
  const [header = "", ...entries] = text.split("\0");
  const names = header.split(" ");
  const count = names.length * PIECES.length;
  if (!names.every(isPieceStyle) || entries.length !== count * 2) {
    throw new Error("Piece drawings are malformed");
  }
  const sets = new Map<PieceStyle, PieceSetDrawings>();
  names.forEach((name, i) => {
    const ladder = entries.slice(i * PIECES.length, (i + 1) * PIECES.length);
    const boxes = entries.slice(count + i * PIECES.length, count + (i + 1) * PIECES.length);
    const uniform = ladder.map((svg, p) => {
      const root = /^<svg viewBox="[^"]*"/;
      if (!root.test(svg)) throw new Error("Piece drawings are malformed");
      return svg.replace(root, `<svg viewBox="${boxes[p]}"`);
    });
    sets.set(name, { ladder, uniform });
  });
  return sets;
}

/** Percent-encode only characters that would break a CSS url(). */
function toDataUrl(svgText: string): string {
  const compact = svgText
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/"/g, "'")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/ /g, "%20");
  return `url("data:image/svg+xml,${compact}")`;
}

/**
 * A set's rules, scoped to `.cg-wrap.piece-set-<set>` so they beat Chessground's bundled cburnett
 * sprites; `.piece-sizes-uniform` on the same node swaps in the uniform drawings.
 */
export function pieceSetCss(style: PieceStyle, set: PieceSetDrawings): string {
  return PIECES.map(([role, color], p) => {
    const piece = `piece.${role}.${color}`;
    return (
      `.cg-wrap.piece-set-${style} ${piece}{background-image:${toDataUrl(set.ladder[p]!)}}` +
      `.cg-wrap.piece-set-${style}.piece-sizes-uniform ${piece}{background-image:${toDataUrl(set.uniform[p]!)}}`
    );
  }).join("");
}

async function inflate(): Promise<Map<PieceStyle, PieceSetDrawings>> {
  const response = await fetch(gzUrl);
  if (!response.ok || !response.body) throw new Error("Piece drawings did not load");
  // Vite's dev server already decodes the .gz (Content-Encoding: gzip) before fetch sees it,
  // while the packaged app serves the raw bytes — so sniff the gzip magic instead of assuming.
  const bytes = new Uint8Array(await response.arrayBuffer());
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const stream = compressed
    ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    : new Blob([bytes]).stream();
  return parsePieceDrawings(await new Response(stream).text());
}

let drawings: Promise<Map<PieceStyle, PieceSetDrawings>> | undefined;

/** Inflates the drawings once; a failed load is retried by the next caller. */
export function loadPieceDrawings(): Promise<Map<PieceStyle, PieceSetDrawings>> {
  drawings ??= inflate().catch((error: unknown) => {
    drawings = undefined;
    throw error;
  });
  return drawings;
}

const added = new Set<PieceStyle>();

/** Waits before each retry of a set that failed to load; after the last, it stays unloaded. */
export const PIECE_SET_RETRY_MS = [1000, 2000, 4000];

/**
 * Adds a piece set's CSS to the page, once. Until it lands (or if it can't), boards show
 * Chessground's bundled cburnett, so a missing set never blanks a board. A failed load retries
 * on its own (PIECE_SET_RETRY_MS) rather than waiting for the next component to ask.
 */
export async function ensurePieceSet(style: PieceStyle, attempt = 0): Promise<void> {
  if (added.has(style)) return;
  added.add(style);
  try {
    const set = (await loadPieceDrawings()).get(style);
    if (!set) return;
    const sheet = document.createElement("style");
    sheet.dataset.pieceSet = style;
    sheet.textContent = pieceSetCss(style, set);
    document.head.append(sheet);
  } catch (error) {
    added.delete(style);
    console.error(`piece set ${style} failed to load:`, error);
    const wait = PIECE_SET_RETRY_MS[attempt];
    if (wait !== undefined) setTimeout(() => void ensurePieceSet(style, attempt + 1), wait);
  }
}

/** Keeps `style`'s CSS on the page for a component that shows it. */
export function usePieceSet(style: PieceStyle): void {
  useEffect(() => {
    void ensurePieceSet(style);
  }, [style]);
}
