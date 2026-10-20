import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { SideDot } from "@/components/ui/side-dot";
import { cn } from "@/lib/utils";
import type { PuzzleFeedbackKind, PuzzleOutcome } from "../stores/puzzle-store";

/** A short head shake for a wrong move (Web Animations; skipped under reduced motion). */
const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-4px)" },
  { transform: "translateX(4px)" },
  { transform: "translateX(-2px)" },
  { transform: "translateX(0)" }
];

const feedbackTone: Record<PuzzleFeedbackKind, string> = {
  idle: "border-line bg-surface-sunken",
  correct: "border-accent/30 bg-accent-soft",
  wrong: "border-danger/30 bg-danger-soft",
  complete: "border-accent/40 bg-accent-soft",
  broken: "border-line bg-surface-sunken"
};
/** A failed puzzle that is over: settled, not alarming. */
const failedSettledTone = "border-danger/25 bg-surface-sunken";

/** Headline colour by the mark shown beside it (a broken puzzle's headline is always plain). */
const headlineTone: Record<PuzzleFeedbackKind, string> = {
  idle: "text-fg",
  correct: "text-accent-fg",
  wrong: "text-danger",
  complete: "text-accent-fg",
  broken: "text-fg"
};

/** Where the attempt stands, as the feedback card tells it. */
export type PuzzleFeedbackState = {
  kind: PuzzleFeedbackKind;
  /** The store's sentence about the last move. */
  feedback: string | null;
  outcome: PuzzleOutcome;
  /** Still solving on the board (not since turned into an analysis board). */
  playing: boolean;
  solutionViewed: boolean;
  wrongMoveCount: number;
  /** The solver's moves found so far, of `playerMoves`. */
  playerDone: number;
  playerMoves: number;
};

type FeedbackCopy = { headline: string; detail: string | null; failedNote: string | null };

function liveHeadline(kind: PuzzleFeedbackKind): string {
  if (kind === "correct") return "Correct";
  return kind === "wrong" ? "Not quite" : "Find the best move";
}

function failedDetail(afterWrongMove: boolean, finished: boolean): string {
  if (afterWrongMove) return finished ? "Finished after a wrong move." : "A wrong move was played.";
  return finished ? "Finished with the solution shown." : "The solution was shown.";
}

// The store's sentence repeats the headline for correct / solved; keep only what adds to it.
function liveDetail(kind: PuzzleFeedbackKind, feedback: string | null): string | null {
  if (kind === "idle") return null;
  if (kind === "correct") return feedback && feedback !== "Correct." ? feedback : "Keep going.";
  return feedback?.replace(/^Not quite\.\s*/, "") ?? "Try another move.";
}

// Side to move is the puzzle's heading (and the mark's dot): the idle card just asks.
function feedbackCopy(state: PuzzleFeedbackState, settled: boolean): FeedbackCopy {
  const failed = state.outcome === "failed";
  if (state.kind === "broken") {
    return {
      headline: "Broken puzzle",
      detail: "This puzzle's data is broken — skip it.",
      failedNote: null
    };
  }
  if (settled) {
    return failed
      ? {
          headline: "Failed",
          detail: failedDetail(state.wrongMoveCount > 0, state.kind === "complete"),
          failedNote: null
        }
      : {
          headline: "Solved",
          detail: `${state.playerMoves === 1 ? "The winning move" : `All ${state.playerMoves} moves`} found.`,
          failedNote: null
        };
  }
  return {
    headline: liveHeadline(state.kind),
    detail: liveDetail(state.kind, state.feedback),
    // Once failed it stays failed; while unfinished, say it can still be played out.
    failedNote: failed
      ? state.solutionViewed && !state.wrongMoveCount
        ? "Failed — solution shown. You can still finish it."
        : "Failed — you can still finish it."
      : null
  };
}

/** The live feedback card: what the last move did, and how much of the solution is found. */
export function PuzzleFeedbackCard({
  expectedSan,
  sideToMove,
  state
}: {
  /** The expected move in SAN after a wrong try, for screen readers. */
  expectedSan: string | null;
  sideToMove: "white" | "black";
  state: PuzzleFeedbackState;
}) {
  const { feedback, kind } = state;
  const wrong = kind === "wrong";
  const failed = state.outcome === "failed";
  // Over: finished, broken, or failed and left unfinished (the board has since become an analysis board).
  const settled = kind === "complete" || kind === "broken" || (failed && !state.playing);
  const settledFailed = settled && failed;
  const markKind = settledFailed ? "wrong" : kind;
  const { detail, failedNote, headline } = feedbackCopy(state, settled);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wrong || !feedback) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardRef.current?.animate(SHAKE, { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [wrong, feedback]);

  return (
    <div
      ref={cardRef}
      role="status"
      aria-live="polite"
      className={cn(
        "grid gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-standard ease-standard",
        settledFailed ? failedSettledTone : feedbackTone[kind]
      )}
    >
      <div className="flex items-center gap-2.5">
        <FeedbackMark kind={markKind} sideToMove={sideToMove} />
        <div
          key={`${kind}-${feedback ?? ""}`}
          className="grid min-w-0 flex-1 animate-rise-in gap-0.5"
        >
          <p
            className={cn(
              "text-sm font-semibold",
              kind === "broken" ? "text-fg" : headlineTone[markKind]
            )}
          >
            {headline}
          </p>
          {detail ? <p className="text-xs leading-5 text-fg-secondary">{detail}</p> : null}
          {wrong && expectedSan ? (
            <span className="sr-only"> Expected move: {expectedSan}.</span>
          ) : null}
        </div>
      </div>
      {failedNote ? (
        <p key={failedNote} className="animate-fade-in text-xs font-medium text-danger">
          {failedNote}
        </p>
      ) : null}
      <SolutionProgress done={state.playerDone} total={state.playerMoves} wrong={wrong} />
    </div>
  );
}

function FeedbackMark({
  kind,
  sideToMove
}: {
  kind: PuzzleFeedbackKind;
  sideToMove: "white" | "black";
}) {
  if (kind === "idle") {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-control">
        <SideDot color={sideToMove} size="md" />
      </span>
    );
  }
  const wrong = kind === "wrong";
  const broken = kind === "broken";
  return (
    <span
      key={kind}
      className={cn(
        "grid size-7 shrink-0 animate-pop-in place-items-center rounded-full",
        wrong
          ? "bg-danger/20 text-danger"
          : broken
            ? "bg-control text-fg-muted"
            : kind === "complete"
              ? "bg-accent text-canvas"
              : "bg-accent/20 text-accent"
      )}
    >
      {wrong || broken ? (
        <X className="size-4" strokeWidth={2.5} />
      ) : (
        <Check className="size-4" strokeWidth={kind === "complete" ? 3 : 2.5} />
      )}
    </span>
  );
}

/** One segment per move the solver has to find; the current one turns red after a wrong try. */
function SolutionProgress({ done, total, wrong }: { done: number; total: number; wrong: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex flex-1 gap-1"
        role="progressbar"
        aria-label="Solution progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-control"
          >
            <span
              className={cn(
                "absolute inset-0 origin-left rounded-full transition-transform duration-emphasis ease-enter",
                index < done
                  ? "scale-x-100 bg-accent"
                  : index === done && wrong
                    ? "scale-x-100 bg-danger/70"
                    : "scale-x-0 bg-accent"
              )}
            />
          </span>
        ))}
      </div>
      <span className="shrink-0 text-2xs tabular-nums text-fg-muted">
        {done} of {total} {total === 1 ? "move" : "moves"} found
      </span>
    </div>
  );
}
