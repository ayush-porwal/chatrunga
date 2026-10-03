import { memo, useEffect, useMemo, useRef } from "react";
import { Check, ExternalLink, Loader2, Puzzle, Swords, X } from "lucide-react";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/notice";
import { SideDot } from "@/components/ui/side-dot";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { positionStatus } from "@/lib/position-status";
import { userMoveFromUci } from "@/lib/uci";
import { sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { MoveLink } from "../features/game-review/MoveLinks";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { PuzzleExplanation } from "../features/puzzles/PuzzleExplanation";
import { explainOutcome } from "../features/puzzles/puzzle-explanation";
import { formatPuzzleTag, puzzleDatasetLabel, puzzleSetSummary } from "../features/puzzles/puzzle-set";
import { PuzzleRatingLine } from "../features/puzzles/PuzzleRatingLine";
import { useGameStore } from "../stores/game-store";
import {
  selectFirstWrongMove,
  usePuzzleStore,
  type PuzzleFeedbackKind,
  type PuzzleOutcome,
  type PuzzleWrongMove
} from "../stores/puzzle-store";

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

type PanelProps = {
  nextError: Error | null;
  nextPending: boolean;
  onNextPuzzle: () => void;
  onPlayEngineFromHere: () => void;
  /** Back to the Puzzles page with this set's filters, to change them and start a new set. */
  onEditSet: () => void;
  puzzleConfig: PuzzleSessionConfig | null;
};

/**
 * Active-puzzle section shown atop the Moves tab of the board workspace panel (nothing without an
 * active puzzle). Reads the puzzle session itself, so feedback changes re-render only this panel.
 */
export const PuzzleInfoPanel = memo(function PuzzleInfoPanel(props: PanelProps) {
  const puzzle = usePuzzleStore((state) => state.activePuzzle);
  const attemptId = usePuzzleStore((state) => state.attempt?.id);
  const feedbackKind = usePuzzleStore((state) => state.feedbackKind);
  const feedback = usePuzzleStore((state) => state.feedback);
  const lastExpectedMove = usePuzzleStore((state) => state.lastExpectedMove);
  const solutionIndex = usePuzzleStore((state) => state.solutionIndex);
  const outcome = usePuzzleStore((state) => state.outcome);
  const solutionViewed = usePuzzleStore((state) => state.attempt?.solutionViewed ?? false);
  const wrongMoveCount = usePuzzleStore((state) => state.attempt?.wrongMoves.length ?? 0);
  const firstWrongMove = usePuzzleStore(selectFirstWrongMove);
  const terminal = useGameStore((state) => positionStatus(state.currentFen).isEnd);
  // Still solving on the board (not since turned into an analysis board).
  const playing = useGameStore((state) => state.mode === "puzzle");
  if (!puzzle) return null;
  return (
    // Keyed by attempt, not puzzle: the next one, and this one started again (Back), start with
    // the solution folded and no feedback animation pending (whatever the last try left open).
    <PuzzleCard
      key={attemptId}
      {...props}
      puzzle={puzzle}
      feedbackKind={feedbackKind}
      feedback={feedback}
      lastExpectedMove={lastExpectedMove}
      solutionIndex={solutionIndex}
      outcome={outcome}
      solutionViewed={solutionViewed}
      wrongMoveCount={wrongMoveCount}
      firstWrongMove={firstWrongMove}
      terminal={terminal}
      playing={playing}
    />
  );
});

function PuzzleCard({
  feedback,
  feedbackKind,
  firstWrongMove,
  lastExpectedMove,
  nextError,
  nextPending,
  onEditSet,
  onNextPuzzle,
  onPlayEngineFromHere,
  outcome,
  playing,
  puzzle,
  puzzleConfig,
  solutionIndex,
  solutionViewed,
  terminal,
  wrongMoveCount
}: PanelProps & {
  feedback: string | null;
  feedbackKind: PuzzleFeedbackKind;
  firstWrongMove: PuzzleWrongMove | null;
  lastExpectedMove: string | null;
  outcome: PuzzleOutcome;
  playing: boolean;
  puzzle: PuzzleSample;
  solutionIndex: number;
  solutionViewed: boolean;
  terminal: boolean;
  wrongMoveCount: number;
}) {
  const complete = feedbackKind === "complete";
  const failed = outcome === "failed";
  const wrong = feedbackKind === "wrong";
  // Its data is broken (a scripted reply can't be played): over, neither solved nor failed by it.
  const broken = feedbackKind === "broken";
  const plies = puzzle.solutionMoves.length;
  const progressCount = complete ? plies : Math.min(solutionIndex, plies);
  // The solver plays every other ply; count their moves, not the replies.
  const playerMoves = Math.max(1, Math.ceil(plies / 2));
  const playerDone = Math.min(playerMoves, Math.ceil(progressCount / 2));
  // A theme like "mate in 2" or "fork" gives the answer away, so the puzzle's own tags wait until
  // it is solved or failed (the Set line still shows the filters the user chose).
  const tags = outcome === "pending" ? [] : [...puzzle.themes, ...puzzle.openingTags];
  const solution = useMemo(() => solutionLine(puzzle), [puzzle]);
  // The wrong-move hint for screen readers names the expected move in SAN, like the rest of the UI.
  const expectedSan = lastExpectedMove
    ? (solution.find((move, index) => index >= solutionIndex && move.uci === lastExpectedMove)?.san ?? lastExpectedMove)
    : null;
  // Solved or failed: the AI explanation is offered (never while pending).
  const explainKind = explainOutcome(outcome, firstWrongMove);
  const setLine = puzzleConfig ? puzzleSetSummary(puzzleConfig, puzzleDatasetLabel(puzzle.sourceId, puzzle.sourceName)) : null;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wrong || !feedback) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardRef.current?.animate(SHAKE, { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [wrong, feedback]);

  // Side to move is in the summary above the panel (and the mark's dot): the idle card just asks.
  // Over: finished, broken, or failed and left unfinished (the board has since become an analysis board).
  const settled = complete || broken || (failed && !playing);
  const headline = broken
    ? "Broken puzzle"
    : settled
      ? failed
        ? "Failed"
        : "Solved"
      : feedbackKind === "correct"
        ? "Correct"
        : wrong
          ? "Not quite"
          : "Your turn";
  // The store's sentence repeats the headline for correct / solved; keep only what adds to it.
  const detail = broken
    ? "This puzzle's data is broken — skip it."
    : settled
      ? failed
        ? wrongMoveCount
          ? complete
            ? "Finished after a wrong move."
            : "A wrong move was played."
          : complete
            ? "Finished with the solution shown."
            : "The solution was shown."
        : `${playerMoves === 1 ? "The winning move" : `All ${playerMoves} moves`} found.`
      : feedbackKind === "idle"
        ? "Find the best move."
        : feedbackKind === "correct"
          ? feedback && feedback !== "Correct." ? feedback : "Keep going."
          : (feedback?.replace(/^Not quite\.\s*/, "") ?? "Try another move.");
  // Once failed it stays failed; while unfinished, say it can still be played out.
  const failedNote =
    failed && !settled
      ? solutionViewed && !wrongMoveCount
        ? "Failed — solution shown. You can still finish it."
        : "Failed — you can still finish it."
      : null;

  return (
    <section className="grid shrink-0 gap-3 border-b border-line-subtle pb-3" aria-label="Puzzle">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className={cn(sectionTitle, "truncate")}>Puzzle #{puzzle.id}</h2>
        <div className="flex shrink-0 items-center gap-3 text-right">
          {puzzle.rating ? (
            <span className="grid gap-0.5">
              <span className="text-2xs text-fg-subtle">Rating</span>
              <span className="text-sm font-semibold tabular-nums text-fg">{puzzle.rating}</span>
            </span>
          ) : null}
          {puzzle.difficulty ? (
            <span className="grid gap-0.5">
              <span className="text-2xs text-fg-subtle">Difficulty</span>
              <span className="text-sm font-semibold tabular-nums text-fg">{puzzle.difficulty}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div
        ref={cardRef}
        role="status"
        aria-live="polite"
        className={cn(
          "grid gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-standard ease-standard",
          settled && failed ? failedSettledTone : feedbackTone[feedbackKind]
        )}
      >
        <div className="flex items-center gap-2.5">
          <FeedbackMark kind={settled && failed ? "wrong" : feedbackKind} sideToMove={puzzle.sideToMove} />
          <div key={`${feedbackKind}-${feedback ?? ""}`} className="grid min-w-0 flex-1 animate-rise-in gap-0.5">
            <p
              className={cn(
                "text-sm font-semibold",
                broken ? "text-fg" : wrong || (settled && failed) ? "text-danger" : feedbackKind === "idle" ? "text-fg" : "text-accent-fg"
              )}
            >
              {headline}
            </p>
            <p className="text-xs leading-5 text-fg-secondary">{detail}</p>
            {wrong && expectedSan ? <span className="sr-only"> Expected move: {expectedSan}.</span> : null}
          </div>
        </div>
        {failedNote ? (
          <p key={failedNote} className="animate-fade-in text-xs font-medium text-danger">
            {failedNote}
          </p>
        ) : null}
        <SolutionProgress done={playerDone} total={playerMoves} wrong={wrong} />
      </div>

      <PuzzleRatingLine />

      {complete || failed || broken ? (
        <div className="grid animate-rise-in gap-2">
          {/* Finished or broken: on to the next one. Failed and unfinished: the next one is there to skip to. */}
          <Button
            type="button"
            variant={complete || broken ? "primary" : "outline"}
            className={complete || broken ? "h-10" : undefined}
            disabled={nextPending}
            onClick={onNextPuzzle}
          >
            {nextPending ? <Loader2 className="animate-spin" /> : <Puzzle />}
            {nextPending ? "Finding the next puzzle…" : "Next puzzle"}
          </Button>
          {complete ? (
            <Button
              type="button"
              variant="outline"
              disabled={terminal}
              onClick={onPlayEngineFromHere}
              title={terminal ? "This position is already finished" : "Continue against the default engine"}
            >
              <Swords />
              Play engine from here
            </Button>
          ) : null}
          {nextError ? <Notice tone="danger">{ipcErrorMessage(nextError) || nextError.message}</Notice> : null}
        </div>
      ) : null}

      {explainKind ? <PuzzleExplanation puzzle={puzzle} kind={explainKind} wrong={firstWrongMove} linkMoves={complete} /> : null}

      <Disclosure
        title={complete ? "Solution" : "Show solution"}
        // Looking before it's solved fails the puzzle (as on Lichess): say so before the click.
        summary={outcome === "pending" ? "Counts as failed" : undefined}
        onOpenChange={(open) => {
          if (open) usePuzzleStore.getState().revealSolution();
        }}
      >
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
                  onActivate={() => useGameStore.getState().goToLine("root", solution.slice(0, index + 1).map((item) => item.san))}
                />
              ) : (
                move.san
              )}
            </li>
          ))}
        </ol>
      </Disclosure>

      {tags.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Themes">
          <span className="mr-0.5 text-xs text-fg-subtle" aria-hidden="true">
            Themes
          </span>
          {tags.map((tag) => (
            <Badge key={tag} className="max-w-full">
              <span className="truncate">{formatPuzzleTag(tag)}</span>
            </Badge>
          ))}
        </div>
      ) : null}

      {setLine || puzzle.gameUrl ? (
        <div className="grid gap-1.5">
          {setLine ? (
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <p className="min-w-0 text-xs leading-5 text-fg-muted">
                <span className="text-fg-subtle">Set: </span>
                {setLine}
              </p>
              <Button type="button" variant="link" size="xs" className="shrink-0" onClick={onEditSet}>
                Edit set
              </Button>
            </div>
          ) : null}
          {puzzle.gameUrl ? (
            <a
              href={puzzle.gameUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded text-xs text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Source game
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FeedbackMark({ kind, sideToMove }: { kind: PuzzleFeedbackKind; sideToMove: "white" | "black" }) {
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
        wrong ? "bg-danger/20 text-danger" : broken ? "bg-control text-fg-muted" : kind === "complete" ? "bg-accent text-canvas" : "bg-accent/20 text-accent"
      )}
    >
      {wrong || broken ? <X className="size-4" strokeWidth={2.5} /> : <Check className="size-4" strokeWidth={kind === "complete" ? 3 : 2.5} />}
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
          <span key={index} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-control">
            <span
              className={cn(
                "absolute inset-0 origin-left rounded-full transition-transform duration-emphasis ease-enter",
                index < done ? "scale-x-100 bg-accent" : index === done && wrong ? "scale-x-100 bg-danger/70" : "scale-x-0 bg-accent"
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

type SolutionMove = { uci: string; san: string; number: string | null; valid: boolean };

/**
 * The solution in SAN with move numbers ("12." before White's moves, "12…" when the line starts
 * with Black). Falls back to the raw UCI for a move that cannot be replayed.
 */
function solutionLine(puzzle: PuzzleSample): SolutionMove[] {
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

function safeApply(fen: string, uci: string): ReturnType<typeof applyUserMove> {
  try {
    const move = userMoveFromUci(uci);
    return move ? applyUserMove(fen, move) : null;
  } catch {
    return null;
  }
}
