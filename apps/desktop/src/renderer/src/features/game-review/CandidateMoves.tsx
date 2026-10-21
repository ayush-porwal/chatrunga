import type { ReactNode } from "react";
import type { MoveAnnotation } from "@chaturanga/shared/types/engine";
import type { MaiaRatingBucket } from "@chaturanga/shared/schemas/constants";
import { cn } from "@/lib/utils";
import { EngineAvatar } from "../analysis/EngineAvatar";
import { FigurineSan } from "../analysis/EngineLines";
import { MoveLink, type GoToLine } from "./MoveLinks";
import {
  percent,
  predictionColors,
  type EngineMoveRow,
  type HumanMoveRow,
  type PredictionRow
} from "./rating-curve-chart";
import { formatScore } from "./review-score";

/**
 * The position's candidate moves, as Maia Chess sets them side by side: Maia's at the user's level
 * with how likely each is ("Human moves", when Maia ran there) and the engine's with their score
 * ("Engine moves"). The move played and the best move take their lines' colours; each move plays
 * from the position before the move.
 */
export function CandidateMoves({
  human,
  engine,
  userBucket,
  annotation,
  parentNodeId,
  onGoToLine
}: {
  human: readonly HumanMoveRow[];
  engine: readonly EngineMoveRow[];
  userBucket: MaiaRatingBucket;
  annotation: MoveAnnotation | null;
  /** The position the moves are played from. */
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
}) {
  const colors = predictionColors(annotation);
  const goTo = (san: string) =>
    parentNodeId && onGoToLine
      ? () => onGoToLine({ startNodeId: parentNodeId, moves: [san] })
      : null;
  const cell = (row: PredictionRow) => (
    <MoveCell row={row} color={row.role ? colors[row.role] : undefined} goTo={goTo(row.san)} />
  );
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-[10px] border border-line",
        human.length && engine.length && "grid-cols-2 divide-x divide-line-subtle"
      )}
    >
      {human.length ? (
        <MoveTable
          title={`Human moves · Maia ${userBucket}`}
          icon={
            // Overhangs the caption's line a pixel each way: the caption keeps its height.
            <EngineAvatar
              engine={{ name: "Maia", maiaRating: userBucket }}
              size="xs"
              className="-my-px"
            />
          }
          valueLabel="Chance"
          rows={human.map((row) => ({ key: row.uci, move: cell(row), value: percent(row.prob) }))}
        />
      ) : null}
      {engine.length ? (
        <MoveTable
          title="Engine moves"
          valueLabel="Eval"
          rows={engine.map((row) => ({
            key: row.uci,
            move: cell(row),
            value: formatScore(row.score, 2)
          }))}
        />
      ) : null}
    </div>
  );
}

function MoveTable({
  title,
  icon,
  valueLabel,
  rows
}: {
  title: string;
  /** The model's picture before the title (Maia's on Human moves). */
  icon?: ReactNode;
  valueLabel: string;
  rows: ReadonlyArray<{ key: string; move: ReactNode; value: string }>;
}) {
  return (
    <table className="w-full min-w-0 table-fixed text-[0.8125rem]">
      <caption className="border-b border-line-subtle bg-surface-sunken px-3 py-1.5 text-left text-xs font-medium text-fg-secondary">
        <span className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate">{title}</span>
        </span>
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Move</th>
          <th scope="col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="h-7">
            <td className="truncate pl-3 font-mono">{row.move}</td>
            <td className="w-16 pr-3 text-right font-mono text-fg-secondary tabular-nums">
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A move of a table: a link to its position, in its line's colour when it is the played or best. */
function MoveCell({
  row,
  color,
  goTo
}: {
  row: PredictionRow;
  color: string | undefined;
  goTo: (() => void) | null;
}) {
  const role = row.role === "played" ? " (played)" : row.role === "best" ? " (best)" : "";
  const content = (
    <>
      <FigurineSan san={row.san} />
      {role ? <span className="sr-only">{role}</span> : null}
    </>
  );
  return (
    <span
      className={cn("font-medium", row.role ? "font-semibold" : "text-fg-secondary")}
      style={color ? { color } : undefined}
    >
      {goTo ? (
        <MoveLink san={row.san} onActivate={goTo} className="text-current">
          {content}
        </MoveLink>
      ) : (
        content
      )}
    </span>
  );
}
