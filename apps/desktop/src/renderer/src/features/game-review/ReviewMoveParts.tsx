import { Fragment } from "react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FigurineSan, usePieceSetClass } from "../analysis/EngineLines";
import { MoveMarkDisc } from "../board/MoveMarkDisc";
import { lineMoveNumber } from "../game/move-list-model";
import { MoveLink, type GoToLine } from "./MoveLinks";
import { moveLabel } from "./review-utils";

/*
 * Pieces the Commentary and Engine tabs share: the selected move's header and SAN lines drawn with
 * the board's own pieces.
 */

/**
 * The panel's root classes and style for figurines: a `.cg-wrap` carrying the board's piece set,
 * laid out as a grid (unlayered `.cg-wrap` rules would make it a block with inline-size
 * containment).
 */
export function usePiecePanel(className: string) {
  return {
    className: cn(usePieceSetClass(), className),
    style: { display: "grid", containerType: "normal" } as const
  };
}

/**
 * The selected move: its mark's disc, the move (`16. ♗e3`) and the mark's name (the disc already
 * shows its glyph).
 */
export function ReviewMoveHeader({ move }: { move: MoveReview }) {
  const annotation = move.assessment?.annotation ?? null;
  const number = moveLabel(move).slice(0, -move.san.length).trim();
  return (
    <header className="flex min-h-8 items-center gap-2.5">
      {annotation ? <MoveMarkDisc annotation={annotation} decorative className="size-7" /> : null}
      <h2 className="text-base font-bold text-fg" aria-label={moveLabel(move)}>
        <span aria-hidden>
          <span className="mr-1 font-semibold text-fg-subtle tabular-nums">{number}</span>
          <FigurineSan san={move.san} />
        </span>
      </h2>
      {annotation ? (
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-semibold",
            annotationTone[annotation].badge
          )}
        >
          {annotationLabel(annotation)}
        </span>
      ) : null}
    </header>
  );
}

/**
 * A SAN line read from `fen` (`12. ♕b3 ♗c5 13. ♗xf7+`), with move numbers and figurines, each move
 * a link to the position after it (from `startNodeId`). Inside a `usePiecePanel` root.
 */
export function MoveLine({
  fen,
  startNodeId,
  sans,
  onGoToLine,
  linkClassName
}: {
  /** The position the line starts from (its move numbers). */
  fen: string;
  startNodeId: string | null;
  sans: readonly string[];
  onGoToLine?: GoToLine;
  linkClassName?: string;
}) {
  if (!sans.length) return <>No line returned</>;
  return (
    <>
      {sans.map((san, index) => {
        const number = lineMoveNumber(fen, index);
        return (
          <Fragment key={`${index}-${san}`}>
            {index ? " " : null}
            {/* A move number never wraps away from its move. */}
            <span className={cn(number && "whitespace-nowrap")}>
              {number ? <span className="text-fg-subtle tabular-nums">{number} </span> : null}
              {startNodeId && onGoToLine ? (
                <MoveLink
                  san={san}
                  className={linkClassName}
                  onActivate={() => onGoToLine({ startNodeId, moves: sans.slice(0, index + 1) })}
                >
                  <FigurineSan san={san} />
                </MoveLink>
              ) : (
                // The figurine is decorative: the move is read out as its SAN.
                <span role="img" aria-label={san}>
                  <FigurineSan san={san} />
                </span>
              )}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
