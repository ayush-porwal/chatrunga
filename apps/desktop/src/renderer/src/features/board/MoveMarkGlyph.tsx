import type { MoveAnnotation } from "@chaturanga/shared/types/engine";

/*
 * The glyphs of the board's mark badge, drawn in the badge circle's own 0–100 box: heavy white
 * shapes (14-unit strokes) filling about its central 60% (x 13–87, y 21–84). Geometric art of our
 * own, built from the few shapes below, so every mark shares one weight and baseline.
 */

/** Stroke weight of the hooks, check and cross; the "!" bar is as wide at its top. */
const WEIGHT = 14;
/** Top of every glyph; the dots sit on the same baseline below. */
const TOP = 21;
const DOT_Y = 76;
const DOT_R = 7.5;

const round = (value: number) => Math.round(value * 100) / 100;

/** A filled round dot at (`cx`, DOT_Y), as a closed path. */
function dot(cx: number): string {
  return `M${cx - DOT_R} ${DOT_Y}a${DOT_R} ${DOT_R} 0 1 0 ${2 * DOT_R} 0a${DOT_R} ${DOT_R} 0 1 0 ${-2 * DOT_R} 0Z`;
}

/** "!" centred on `cx`: a bar tapering from 15 wide at the top to 10, rounded at both ends, and a dot. */
function bang(cx: number) {
  const bar = [
    `M${cx - 7.5} ${TOP + 4}`,
    `Q${cx - 7.5} ${TOP} ${cx - 3.5} ${TOP}`,
    `H${cx + 3.5}`,
    `Q${cx + 7.5} ${TOP} ${cx + 7.5} ${TOP + 4}`,
    `L${cx + 5} 61`,
    `Q${cx + 4.7} 64 ${cx + 1.7} 64`,
    `H${cx - 1.7}`,
    `Q${cx - 4.7} 64 ${cx - 5} 61`,
    "Z"
  ].join("");
  return <path key={`bang-${cx}`} d={`${bar}${dot(cx)}`} />;
}

/**
 * "?" centred on `cx`: a hook of radius `r` (stroke centre) opening at its left end, turning over
 * the top and down the right into a short stem on the centre line, and a dot under it.
 */
function query(cx: number, r: number) {
  const cy = TOP + WEIGHT / 2 + r;
  // The bowl ends 50° below its right-hand side, then a curve takes it down onto the stem.
  const angle = (50 * Math.PI) / 180;
  const endX = round(cx + r * Math.cos(angle));
  const endY = round(cy + r * Math.sin(angle));
  const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
  const control = { x: round(endX + tangent.x * 5), y: round(endY + tangent.y * 5) };
  const hook = `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${endX} ${endY}C${control.x} ${control.y} ${cx} ${round(endY + 4)} ${cx} 57`;
  return [
    <path
      key={`hook-${cx}`}
      d={hook}
      fill="none"
      stroke="currentColor"
      strokeWidth={WEIGHT}
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
    <path key={`dot-${cx}`} d={dot(cx)} />
  ];
}

/** A five-pointed star centred on the box, its corners softened by a thin round stroke. */
function star() {
  const outer = 30;
  const inner = 13.5;
  const centre = { x: 50, y: 54 };
  const points = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return `${round(centre.x + radius * Math.cos(angle))} ${round(centre.y + radius * Math.sin(angle))}`;
  });
  return (
    <path
      d={`M${points.join("L")}Z`}
      stroke="currentColor"
      strokeWidth={4}
      strokeLinejoin="round"
    />
  );
}

const stroked = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: WEIGHT,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const;

/** The glyph shapes for `annotation`, to draw in white inside the badge's 0–100 circle. */
export function MoveMarkGlyph({ annotation }: { annotation: MoveAnnotation }) {
  switch (annotation) {
    case "brilliant":
      return [bang(39), bang(61)];
    case "great":
      return bang(50);
    case "excellent":
      return star();
    case "good":
      return <path d="M26 51L42 67L75 33" {...stroked} />;
    case "miss":
      return <path d="M32 32L68 68M68 32L32 68" {...stroked} />;
    case "inaccuracy":
      return [...query(40, 10), bang(70)];
    case "mistake":
      return query(50, 12.5);
    case "blunder":
      return [...query(31.5, 10), ...query(68.5, 10)];
  }
}
