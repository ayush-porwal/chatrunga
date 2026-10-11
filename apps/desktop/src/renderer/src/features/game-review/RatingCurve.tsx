import { useState } from "react";
import type { MoveAnnotation } from "@chaturanga/shared/types/engine";
import { MAIA_BUCKETS, type MaiaRatingBucket } from "@chaturanga/shared/schemas/constants";
import { SectionHeader } from "@/components/ui/page";
import { FigurineSan } from "../analysis/EngineLines";
import { MoveLink, type GoToLine } from "./MoveLinks";
import { LegendMarker, PredictionPlot } from "./PredictionPlot";
import {
  PREDICTION_ROLE_NAMES,
  percent,
  predictionColors,
  type PredictionLine,
  type PredictionRole
} from "./rating-curve-chart";

/**
 * Human prediction, after Maia Chess's "Moves by rating": how often Maia expects players at each
 * rating level to play the move played, the engine's best and Maia's own pick at the user's level,
 * one line each (dots at every level, the move named at its end, a soft fill under it), the user's
 * level shaded. The legend names the moves: pointing at one brings its line forward, clicking it
 * plays it from the position before the move. Screen readers also get the numbers as a table.
 */
export function RatingCurve({
  lines,
  userBucket,
  annotation,
  parentNodeId,
  onGoToLine
}: {
  lines: readonly PredictionLine[];
  userBucket: MaiaRatingBucket;
  /** The played move's mark (its line's colour). */
  annotation: MoveAnnotation | null;
  /** The position the moves are played from. */
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
}) {
  const colors = predictionColors(annotation);
  const [emphasis, setEmphasis] = useState<PredictionRole | null>(null);
  return (
    <section className="grid gap-2 rounded-[10px] border border-line bg-surface-sunken px-3 pt-2.5 pb-2">
      <SectionHeader as="h3" title="Human prediction" className="min-h-0" />
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-fg-secondary">
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
      <PredictionPlot lines={lines} userBucket={userBucket} colors={colors} emphasis={emphasis} />
      <PredictionTable lines={lines} userBucket={userBucket} />
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
  userBucket
}: {
  lines: readonly PredictionLine[];
  userBucket: MaiaRatingBucket;
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
        {MAIA_BUCKETS.map((rating, index) => (
          <tr key={rating}>
            <th scope="row">
              {rating}
              {rating === userBucket ? " (your rating)" : ""}
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
