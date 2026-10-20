import { useState } from "react";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { userMoveFromUci } from "@/lib/uci";
import { cn } from "@/lib/utils";
import { MoveLink } from "../features/game-review/MoveLinks";
import { usePuzzleStore, type PuzzleOutcome } from "../stores/puzzle-store";
import { useGameStore } from "../stores/game-store";

type SolutionMove = { uci: string; san: string; number: string | null; valid: boolean };

/**
 * The solution folded under "Show solution"; once finished, each move jumps the board there.
 * Looking before it's decided fails the puzzle (as on Lichess), so that asks first.
 */
export function PuzzleSolution({
  complete,
  outcome,
  progressCount,
  solution
}: {
  complete: boolean;
  outcome: PuzzleOutcome;
  /** Plies of the solution already on the board. */
  progressCount: number;
  solution: SolutionMove[];
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reveal = () => {
    usePuzzleStore.getState().revealSolution();
    setOpen(true);
  };
  return (
    <>
      <Disclosure
        title={complete ? "Solution" : "Show solution"}
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
          else if (outcome === "pending") setConfirming(true);
          else reveal();
        }}
      >
        <SolutionMoves complete={complete} progressCount={progressCount} solution={solution} />
      </Disclosure>
      {confirming ? (
        <Dialog
          size="sm"
          title="Show the solution?"
          description="The puzzle counts as failed, and a rated puzzle lowers your puzzle rating."
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Keep solving
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                className="border-danger/35 bg-danger-soft text-danger"
                onClick={() => {
                  setConfirming(false);
                  reveal();
                }}
              >
                Show solution
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}

/** The solution's moves, in SAN with move numbers; once finished, each jumps the board there. */
function SolutionMoves({
  complete,
  progressCount,
  solution
}: {
  complete: boolean;
  progressCount: number;
  solution: SolutionMove[];
}) {
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-1 text-sm leading-6" aria-label="Solution moves">
      {solution.map((move, index) => (
        <li
          key={`${index}-${move.uci}`}
          className={cn("tabular-nums", index < progressCount ? "text-fg" : "text-fg-muted")}
        >
          {move.number ? <span className="mr-1 text-fg-subtle">{move.number}</span> : null}
          {/* Once finished every move is on the board's line: each one jumps there. */}
          {complete && move.valid ? (
            <MoveLink
              san={move.san}
              onActivate={() =>
                useGameStore.getState().goToLine(
                  "root",
                  solution.slice(0, index + 1).map((item) => item.san)
                )
              }
            />
          ) : (
            move.san
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The solution in SAN with move numbers ("12." before White's moves, "12…" when the line starts
 * with Black). Falls back to the raw UCI for a move that cannot be replayed.
 */
export function solutionLine(puzzle: PuzzleSample): SolutionMove[] {
  const [, turn = "w", , , , fullmove = "1"] = puzzle.initialFen.split(" ");
  let moveNumber = Number(fullmove) || 1;
  let whiteToMove = turn === "w";
  let fen: string | null = puzzle.initialFen;
  return puzzle.solutionMoves.map((uci, index) => {
    const applied = fen ? safeApply(fen, uci) : null;
    fen = applied?.fen ?? null;
    const number = whiteToMove ? `${moveNumber}.` : index === 0 ? `${moveNumber}…` : null;
    if (!whiteToMove) moveNumber += 1;
    whiteToMove = !whiteToMove;
    return { uci, san: applied?.san ?? uci, number, valid: Boolean(applied) };
  });
}

/** The move the solver should have played (in SAN, like the rest of the UI; UCI if unplayable). */
export function expectedMoveSan(
  solution: SolutionMove[],
  solutionIndex: number,
  expectedUci: string | null
): string | null {
  if (!expectedUci) return null;
  return (
    solution.find((move, index) => index >= solutionIndex && move.uci === expectedUci)?.san ??
    expectedUci
  );
}

function safeApply(fen: string, uci: string): ReturnType<typeof applyUserMove> {
  try {
    const move = userMoveFromUci(uci);
    return move ? applyUserMove(fen, move) : null;
  } catch {
    return null;
  }
}
