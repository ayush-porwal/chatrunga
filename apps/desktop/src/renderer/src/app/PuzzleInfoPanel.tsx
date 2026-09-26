import { memo, useEffect, useMemo, useRef } from "react";
import { Check, ExternalLink, Loader2, Puzzle, Swords, X } from "lucide-react";
import { applyUserMove } from "@chaturanga/shared/chess/position";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/notice";
import { SideDot } from "@/components/ui/side-dot";
import { positionStatus } from "@/lib/position-status";
import { userMoveFromUci } from "@/lib/uci";
import { sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { MoveLink } from "../features/game-review/MoveLinks";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";

type PuzzleFeedbackKind = "idle" | "correct" | "wrong" | "complete";

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
  complete: "border-accent/40 bg-accent-soft"
};

type PanelProps = {
  nextError: Error | null;
  nextPending: boolean;
  onNextPuzzle: () => void;
  onPlayEngineFromHere: () => void;
  puzzleConfig: PuzzleSessionConfig | null;
};

/**
 * Active-puzzle section shown atop the Moves tab of the board workspace panel (nothing without an
 * active puzzle). Reads the puzzle session itself, so feedback changes re-render only this panel.
 */
export const PuzzleInfoPanel = memo(function PuzzleInfoPanel(props: PanelProps) {
  const puzzle = usePuzzleStore((state) => state.activePuzzle);
  const feedbackKind = usePuzzleStore((state) => state.feedbackKind);
  const feedback = usePuzzleStore((state) => state.feedback);
  const lastExpectedMove = usePuzzleStore((state) => state.lastExpectedMove);
  const solutionIndex = usePuzzleStore((state) => state.solutionIndex);
  const terminal = useGameStore((state) => positionStatus(state.currentFen).isEnd);
  if (!puzzle) return null;
  return (
    <PuzzleCard
      {...props}
      puzzle={puzzle}
      feedbackKind={feedbackKind}
      feedback={feedback}
      lastExpectedMove={lastExpectedMove}
      solutionIndex={solutionIndex}
      terminal={terminal}
    />
  );
});

function PuzzleCard({
  feedback,
  feedbackKind,
  lastExpectedMove,
  nextError,
  nextPending,
  onNextPuzzle,
  onPlayEngineFromHere,
  puzzle,
  puzzleConfig,
  solutionIndex,
  terminal
}: PanelProps & {
  feedback: string | null;
  feedbackKind: PuzzleFeedbackKind;
  lastExpectedMove: string | null;
  puzzle: PuzzleSample;
  solutionIndex: number;
  terminal: boolean;
}) {
  const solved = feedbackKind === "complete";
  const wrong = feedbackKind === "wrong";
  const plies = puzzle.solutionMoves.length;
  const progressCount = solved ? plies : Math.min(solutionIndex, plies);
  // The solver plays every other ply; count their moves, not the replies.
  const playerMoves = Math.max(1, Math.ceil(plies / 2));
  const playerDone = Math.min(playerMoves, Math.ceil(progressCount / 2));
  const tags = [...puzzle.themes, ...puzzle.openingTags].slice(0, 10);
  const side = puzzle.sideToMove === "white" ? "White" : "Black";
  const solution = useMemo(() => solutionLine(puzzle), [puzzle]);
  // The wrong-move hint for screen readers names the expected move in SAN, like the rest of the UI.
  const expectedSan = lastExpectedMove
    ? (solution.find((move, index) => index >= solutionIndex && move.uci === lastExpectedMove)?.san ?? lastExpectedMove)
    : null;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wrong || !feedback) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardRef.current?.animate(SHAKE, { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [wrong, feedback]);

  const headline =
    feedbackKind === "complete"
      ? "Solved"
      : feedbackKind === "correct"
        ? "Correct"
        : feedbackKind === "wrong"
          ? "Not quite"
          : `${side} to move`;
  // The store's sentence repeats the headline for correct / solved; keep only what adds to it.
  const detail =
    feedbackKind === "idle"
      ? "Find the best move."
      : feedbackKind === "complete"
        ? `${playerMoves === 1 ? "The winning move" : `All ${playerMoves} moves`} found.`
        : feedbackKind === "correct"
          ? feedback && feedback !== "Correct." ? feedback : "Keep going."
          : (feedback?.replace(/^Not quite\.\s*/, "") ?? "Try another move.");

  return (
    <section className="grid shrink-0 gap-3 border-b border-line-subtle pb-3" aria-label="Puzzle">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className={cn(sectionTitle, "truncate")}>Puzzle #{puzzle.id}</h2>
          <p className="truncate text-xs text-fg-muted" title={puzzle.sourceName}>
            {puzzle.sourceName}
          </p>
        </div>
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
        className={cn("grid gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-standard ease-standard", feedbackTone[feedbackKind])}
      >
        <div className="flex items-center gap-2.5">
          <FeedbackMark kind={feedbackKind} sideToMove={puzzle.sideToMove} />
          <div key={`${feedbackKind}-${feedback ?? ""}`} className="grid min-w-0 flex-1 animate-rise-in gap-0.5">
            <p
              className={cn(
                "text-sm font-semibold",
                wrong ? "text-danger" : feedbackKind === "idle" ? "text-fg" : "text-accent-fg"
              )}
            >
              {headline}
            </p>
            <p className="text-xs leading-5 text-fg-secondary">{detail}</p>
            {wrong && expectedSan ? <span className="sr-only"> Expected move: {expectedSan}.</span> : null}
          </div>
        </div>
        <SolutionProgress done={playerDone} total={playerMoves} wrong={wrong} />
      </div>

      {solved ? (
        <div className="grid animate-rise-in gap-2">
          <Button type="button" variant="primary" className="h-10" disabled={nextPending} onClick={onNextPuzzle}>
            {nextPending ? <Loader2 className="animate-spin" /> : <Puzzle />}
            {nextPending ? "Finding the next puzzle…" : "Next puzzle"}
          </Button>
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
          {nextError ? <Notice tone="danger">{nextError.message}</Notice> : null}
        </div>
      ) : null}

      <div className="grid gap-1">
        <Disclosure title={solved ? "Solution" : "Show solution"}>
          <ol className="flex flex-wrap gap-x-2 gap-y-1 text-sm leading-6" aria-label="Solution moves">
            {solution.map((move, index) => (
              <li
                key={`${index}-${move.uci}`}
                className={cn("tabular-nums", index < progressCount ? "text-fg" : "text-fg-muted")}
              >
                {move.number ? <span className="mr-1 text-fg-subtle">{move.number}</span> : null}
                {/* Once solved every move is on the board's line: each one jumps there. */}
                {solved && move.valid ? (
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
        {puzzleConfig ? (
          <Disclosure title="Next puzzle filters">
            <div className="flex flex-wrap gap-1.5">
              {puzzleFilterChips(puzzleConfig).map((chip) => (
                <Badge key={chip}>{chip}</Badge>
              ))}
            </div>
          </Disclosure>
        ) : null}
      </div>

      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} className="max-w-full">
              <span className="truncate">{formatTag(tag)}</span>
            </Badge>
          ))}
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
  return (
    <span
      key={kind}
      className={cn(
        "grid size-7 shrink-0 animate-pop-in place-items-center rounded-full",
        wrong ? "bg-danger/20 text-danger" : kind === "complete" ? "bg-accent text-canvas" : "bg-accent/20 text-accent"
      )}
    >
      {wrong ? <X className="size-4" strokeWidth={2.5} /> : <Check className="size-4" strokeWidth={kind === "complete" ? 3 : 2.5} />}
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
        {done}/{total}
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
    return applyUserMove(fen, userMoveFromUci(uci));
  } catch {
    return null;
  }
}

/** "mateIn2" → "mate in 2", "Caro-Kann_Defense" → "Caro-Kann Defense". */
function formatTag(value: string): string {
  if (value.includes("_")) return value.replace(/_/g, " ");
  return value.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
}

function puzzleFilterChips(config: PuzzleSessionConfig): string[] {
  if (config.mode === "lichess-puzzle") {
    return [
      `rating ${config.lichess.ratingMin}–${config.lichess.ratingMax}`,
      `popularity ${config.lichess.popularityMin}+`,
      `side ${config.lichess.side}`,
      ...(config.lichess.themes.length ? config.lichess.themes.map(formatTag) : ["any theme"]),
      ...(config.lichess.openings.length ? config.lichess.openings.map(formatTag) : []),
      ...(config.lichess.lengths.length ? config.lichess.lengths.map(formatTag) : [])
    ].slice(0, 12);
  }
  return [
    `difficulty ${config.position.difficultyMin}–${config.position.difficultyMax}`,
    ...(config.position.tags.length ? config.position.tags.map(formatTag) : ["any tag"])
  ].slice(0, 12);
}
