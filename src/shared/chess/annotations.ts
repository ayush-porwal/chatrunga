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

const calPattern = /\[%cal\s+([^\]]+)\]/g;
const cslPattern = /\[%csl\s+([^\]]+)\]/g;
const squarePattern = /^[a-h][1-8]$/;

export function stripAnnotationTags(comment: string): string {
  return comment.replace(calPattern, "").replace(cslPattern, "").replace(/\s+/g, " ").trim();
}

export function parseAnnotationComment(comment: string): {
  text: string | null;
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
} {
  const arrows: BoardArrow[] = [];
  const highlights: BoardHighlight[] = [];

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
  return { text: text || null, arrows, highlights };
}

export function serializeAnnotationComment(
  text: string | null,
  arrows: BoardArrow[],
  highlights: BoardHighlight[]
): string | null {
  const parts: string[] = [];
  if (text?.trim()) parts.push(text.trim());
  if (arrows.length) {
    parts.push(`[%cal ${arrows.map((arrow) => `${colorToTag[arrow.color]}${arrow.orig}${arrow.dest}`).join(",")}]`);
  }
  if (highlights.length) {
    parts.push(`[%csl ${highlights.map((highlight) => `${colorToTag[highlight.color]}${highlight.square}`).join(",")}]`);
  }
  return parts.length ? parts.join(" ") : null;
}
