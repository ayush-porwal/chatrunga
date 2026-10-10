// The drawings ship as compact SVG text, inflated before first paint, then wrapped as CSS.
import gzUrl from "./generated-piece-themes.css.gz?url";

const THEMES = [
  "merida",
  "alpha",
  "california",
  "cardinal",
  "chessnut",
  "kosal",
  "maestro",
  "pirouetti"
] as const;

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

export async function pieceThemeCss(): Promise<string> {
  const response = await fetch(gzUrl);
  if (!response.ok || !response.body) throw new Error("Piece theme drawings did not load");
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const svgs = text.split("\0");
  if (svgs.length !== THEMES.length * PIECES.length) {
    throw new Error("Piece theme drawings did not load");
  }
  const rules: string[] = [];
  let index = 0;
  for (const theme of THEMES) {
    for (const [role, color] of PIECES) {
      rules.push(
        `.cg-wrap.piece-set-${theme} piece.${role}.${color}{background-image:${toDataUrl(svgs[index++]!)}}`
      );
    }
  }
  return rules.join("");
}
