import { useState, type ReactNode } from "react";
import type { MoveAnnotation } from "@chaturanga/shared/types/engine";
import { SectionHeader } from "@/components/ui/page";
import { FigurineSan } from "../analysis/EngineLines";
import { MoveLink, type GoToLine } from "./MoveLinks";
import { LegendMarker, PREDICTION_PLOT_HEIGHT, PredictionPlot } from "./PredictionPlot";
import {
  PREDICTION_ROLE_NAMES,
  percent,
  predictionColors,
  type PredictionCurve,
  type PredictionLine,
  type PredictionRole
} from "./rating-curve-chart";

/** The legend's row: one line of 12px text (so a placeholder keeps the curve's height). */
const LEGEND_HEIGHT = "1.25rem";

/**
 * Human prediction, after Maia Chess's "Moves by rating": how often Maia expects players at each
 * rating to play the move played, the engine's best and Maia's own pick at the marked rating, one
 * line each (dots at every rating, the move named at its end, a soft fill under it), the marked
 * rating shaded (the mover's for Maia 3, the user's level for Maia 1). The legend names the moves:
 * pointing at one brings its line forward, clicking it plays it from the position before the move.
 * Screen readers also get the numbers as a table.
 */
export function RatingCurve({
  curve,
  marked,
  markLabel,
  annotation,
  parentNodeId,
  onGoToLine
}: {
  curve: PredictionCurve;
  /** The rating shaded. */
  marked: number;
  /** The word over it ("You"). */
  markLabel: string;
  /** The played move's mark (its line's colour). */
  annotation: MoveAnnotation | null;
  /** The position the moves are played from. */
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
}) {
  const { lines, ratings } = curve;
  const colors = predictionColors(annotation);
  const [emphasis, setEmphasis] = useState<PredictionRole | null>(null);
  return (
    <RatingCurveFrame>
      <ul
        className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-fg-secondary"
        style={{ minHeight: LEGEND_HEIGHT }}
      >
        {lines.map((line) => (
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- pointing at (or focusing the move link of) a legend entry only brings its line forward; it does nothing else
          <li
            key={line.role}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
            onPointerEnter={() => setEmphasis(line.role)}
            onPointerLeave={() => setEmphasis(null)}
            onFocus={() => setEmphasis(line.role)}
            onBlur={() => setEmphasis(null)}
          >
            <LegendMarker role={line.role} color={colors[line.role]} />
            {PREDICTION_ROLE_NAMES[line.role]}
            <LegendMove
              san={line.san}
              goTo={
                parentNodeId && onGoToLine
                  ? () => onGoToLine({ startNodeId: parentNodeId, moves: [line.san] })
                  : null
              }
            />
          </li>
        ))}
      </ul>
      <PredictionPlot
        lines={lines}
        ratings={ratings}
        marked={marked}
        markLabel={markLabel}
        colors={colors}
        emphasis={emphasis}
      />
      <PredictionTable lines={lines} ratings={ratings} marked={marked} markLabel={markLabel} />
    </RatingCurveFrame>
  );
}

/**
 * The curve's box: its title, `children` (the legend and the plot), and the note under it. Without
 * a curve yet, `placeholder` holds the legend's and the plot's height, centred in it (Maia reading
 * the move, or why it can't), so the panel doesn't move when the curve arrives.
 */
export function RatingCurveFrame({
  children,
  placeholder
}: {
  children?: ReactNode;
  placeholder?: ReactNode;
}) {
  return (
    <section className="grid gap-2 rounded-[10px] border border-line bg-surface-sunken px-3 pt-2.5 pb-2">
      <SectionHeader as="h3" title="Human prediction" className="min-h-0" />
      {placeholder === undefined ? (
        children
      ) : (
        <div
          className="grid place-items-center text-center text-xs text-fg-muted"
          style={{ height: `calc(${LEGEND_HEIGHT} + 0.5rem + ${PREDICTION_PLOT_HEIGHT}px)` }}
        >
          {placeholder}
        </div>
      )}
      <p className="text-2xs leading-4 text-fg-subtle">
        Maia model estimate, not a claim about every player
      </p>
    </section>
  );
}

/** A legend's move: a link to its position when the panel can go there. */
function LegendMove({ san, goTo }: { san: string; goTo: (() => void) | null }) {
  const figurine = <FigurineSan san={san} />;
  return (
    <span className="font-mono font-medium text-fg">
      {goTo ? (
        <MoveLink san={san} onActivate={goTo} className="text-current">
          {figurine}
        </MoveLink>
      ) : (
        figurine
      )}
    </span>
  );
}

/** The chart's numbers for screen readers. */
function PredictionTable({
  lines,
  ratings,
  marked,
  markLabel
}: {
  lines: readonly PredictionLine[];
  ratings: readonly number[];
  marked: number;
  markLabel: string;
}) {
  return (
    <table className="sr-only">
      <caption>Share of players expected to play each move, by rating</caption>
      <thead>
        <tr>
          <th scope="col">Rating</th>
          {lines.map((line) => (
            <th key={line.role} scope="col">
              {PREDICTION_ROLE_NAMES[line.role]} {line.san}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ratings.map((rating, index) => (
          <tr key={rating}>
            <th scope="row">
              {rating}
              {rating === marked ? ` (${markLabel})` : ""}
            </th>
            {lines.map((line) => (
              <td key={line.role}>{percent(line.probs[index])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
