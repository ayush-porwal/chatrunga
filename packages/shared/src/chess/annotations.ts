import type { AnnotationColor, BoardArrow, BoardHighlight, Square } from "../types/chess";

const colorToTag: Record<AnnotationColor, string> = {
  green: "G",
  red: "R",
  yellow: "Y",
  blue: "B"
};

const tagToColor: Record<string, AnnotationColor> = {
  G: "green",
  R: "red",
  Y: "yellow",
  B: "blue"
};

const calPattern = /\[%cal\s+([^\]]+)\]/gi;
const cslPattern = /\[%csl\s+([^\]]+)\]/gi;
/** PGN clock tag; space after `clk` is optional (some exports omit it). */
const clkPattern = /\[%clk\s*([^\]]+)\]/gi;
const squarePattern = /^[a-h][1-8]$/;

export function stripAnnotationTags(comment: string): string {
  return comment
    .replace(calPattern, "")
    .replace(cslPattern, "")
    .replace(clkPattern, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAnnotationComment(comment: string): {
  text: string | null;
  clock: string | null;
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
} {
  const arrows: BoardArrow[] = [];
  const highlights: BoardHighlight[] = [];

  let clock: string | null = null;
  for (const match of comment.matchAll(clkPattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const display = raw.split(";")[0]?.trim();
    if (display) clock = display;
  }

  for (const match of comment.matchAll(calPattern)) {
    for (const token of match[1].split(",")) {
      const trimmed = token.trim();
      const color = tagToColor[trimmed[0]];
      const orig = trimmed.slice(1, 3);
      const dest = trimmed.slice(3, 5);
      if (color && squarePattern.test(orig) && squarePattern.test(dest)) {
        arrows.push({ color, orig: orig as Square, dest: dest as Square });
      }
    }
  }

  for (const match of comment.matchAll(cslPattern)) {
    for (const token of match[1].split(",")) {
      const trimmed = token.trim();
      const color = tagToColor[trimmed[0]];
      const square = trimmed.slice(1, 3);
      if (color && squarePattern.test(square)) {
        highlights.push({ color, square: square as Square });
      }
    }
  }

  const text = stripAnnotationTags(comment);
  return { text: text || null, clock, arrows, highlights };
}

export function serializeAnnotationComment(
  text: string | null,
  arrows: BoardArrow[],
  highlights: BoardHighlight[],
  clock?: string | null
): string | null {
  const parts: string[] = [];
  // A `}` would end the PGN comment early; the text keeps a `)` in its place.
  if (text?.trim()) parts.push(text.trim().replace(/}/g, ")"));
  if (arrows.length) {
    parts.push(
      `[%cal ${arrows.map((arrow) => `${colorToTag[arrow.color]}${arrow.orig}${arrow.dest}`).join(",")}]`
    );
  }
  if (highlights.length) {
    parts.push(
      `[%csl ${highlights.map((highlight) => `${colorToTag[highlight.color]}${highlight.square}`).join(",")}]`
    );
  }
  if (clock?.trim()) parts.push(`[%clk ${clock.trim()}]`);
  return parts.length ? parts.join(" ") : null;
}
