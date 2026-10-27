import { memo, useMemo } from "react";
import { ExternalLink, Loader2, Puzzle, Swords } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { positionStatus } from "@/lib/position-status";
import { sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { PuzzleExplanation } from "../features/puzzles/PuzzleExplanation";
import { GamePuzzleFacts } from "../features/puzzles/GamePuzzleFacts";
import { gamePuzzleFor } from "../features/puzzles/game-puzzle-set";
import { explainOutcome } from "../features/puzzles/puzzle-explanation";
import { formatPuzzleTag, puzzleDatasetLabel } from "../features/puzzles/puzzle-set";
import { PuzzleRatingLine } from "../features/puzzles/PuzzleRatingLine";
import { useGameStore } from "../stores/game-store";
import {
  selectFirstWrongMove,
  usePuzzleStore,
  type PuzzleFeedbackKind,
  type PuzzleOutcome,
  type PuzzleWrongMove
} from "../stores/puzzle-store";
import { PuzzleFeedbackCard } from "./PuzzleFeedbackCard";
import { expectedMoveSan, PuzzleSolution, solutionLine } from "./PuzzleSolution";

type PanelProps = {
  nextError: Error | null;
  nextPending: boolean;
  onNextPuzzle: () => void;
  onPlayEngineFromHere: () => void;
  /** A finished "From my games" puzzle's Open game. */
  onOpenGamePuzzleGame: (puzzle: GamePuzzle) => void;
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
  onNextPuzzle,
  onOpenGamePuzzleGame,
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
  // Its data is broken (a scripted reply can't be played): over, neither solved nor failed by it.
  const broken = feedbackKind === "broken";
  const plies = puzzle.solutionMoves.length;
  const progressCount = complete ? plies : Math.min(solutionIndex, plies);
  // The solver plays every other ply; count their moves, not the replies.
  const playerMoves = Math.max(1, Math.ceil(plies / 2));
  const playerDone = Math.min(playerMoves, Math.ceil(progressCount / 2));
  const solution = useMemo(() => solutionLine(puzzle), [puzzle]);
  // Solved or failed: the AI explanation is offered (never while pending).
  const explainKind = explainOutcome(outcome, firstWrongMove, broken);
  const nextActions = (
    <PuzzleNextActions
      complete={complete}
      broken={broken}
      terminal={terminal}
      nextPending={nextPending}
      onNextPuzzle={onNextPuzzle}
      onPlayEngineFromHere={onPlayEngineFromHere}
    />
  );

  return (
    <section className="grid shrink-0 gap-3 border-b border-line-subtle pb-3" aria-label="Puzzle">
      <PuzzleHeading puzzle={puzzle} />

      <PuzzleFeedbackCard
        sideToMove={puzzle.sideToMove}
        expectedSan={expectedMoveSan(solution, solutionIndex, lastExpectedMove)}
        state={{
          kind: feedbackKind,
          feedback,
          outcome,
          playing,
          solutionViewed,
          wrongMoveCount,
          playerDone,
          playerMoves
        }}
      />

      <PuzzleRatingLine />

      {complete || failed || broken ? (
        <div className="grid animate-rise-in gap-2">
          {explainKind ? (
            <PuzzleExplanation
              puzzle={puzzle}
              kind={explainKind}
              wrong={firstWrongMove}
              linkMoves={complete}
              actions={nextActions}
            />
          ) : (
            <div className="flex items-center gap-2">{nextActions}</div>
          )}
          {nextError ? (
            <Notice tone="danger">{ipcErrorMessage(nextError) || nextError.message}</Notice>
          ) : null}
        </div>
      ) : null}

      <PuzzleSolution
        complete={complete}
        outcome={outcome}
        progressCount={progressCount}
        solution={solution}
      />

      <PuzzleThemes puzzle={puzzle} outcome={outcome} />

      {complete || failed || broken ? (
        <GamePuzzleSource puzzle={puzzle} onOpenGame={onOpenGamePuzzleGame} />
      ) : null}

      <PuzzleSource puzzle={puzzle} puzzleConfig={puzzleConfig} />
    </section>
  );
}

/**
 * Who is to move (the solver's side), the puzzle's number under it, and its rating and difficulty
 * when the dataset has them.
 */
function PuzzleHeading({ puzzle }: { puzzle: PuzzleSample }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="grid min-w-0 gap-0.5">
        <h2 className={cn(sectionTitle, "truncate")}>
          {puzzle.sideToMove === "white" ? "White" : "Black"} to move
        </h2>
        <p className="truncate text-2xs text-fg-subtle">Puzzle #{puzzle.id}</p>
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
  );
}

/**
 * What to do once the puzzle is over (or failed), one row: Next puzzle, then Play engine from here
 * (solved only) as an icon button. Explain with AI joins the row when it is offered.
 */
function PuzzleNextActions({
  broken,
  complete,
  nextPending,
  onNextPuzzle,
  onPlayEngineFromHere,
  terminal
}: Pick<PanelProps, "nextPending" | "onNextPuzzle" | "onPlayEngineFromHere"> & {
  broken: boolean;
  complete: boolean;
  terminal: boolean;
}) {
  const over = complete || broken;
  return (
    <>
      {/* Finished or broken: on to the next one. Failed and unfinished: the next one is there to skip to. */}
      <Button
        type="button"
        variant={over ? "primary" : "outline"}
        className="min-w-0 flex-1"
        disabled={nextPending}
        onClick={onNextPuzzle}
      >
        {nextPending ? <Loader2 className="animate-spin" /> : <Puzzle />}
        {nextPending ? "Finding the next puzzle…" : "Next puzzle"}
      </Button>
      {complete ? (
        <IconButton
          label="Play engine from here"
          // Over (mate or stalemate): nothing to play on, and the tooltip says so.
          disabledReason="This position is already finished"
          icon={swordsIcon}
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={terminal}
          onClick={onPlayEngineFromHere}
        />
      ) : null}
    </>
  );
}

const swordsIcon = <Swords />;

function PuzzleThemes({ outcome, puzzle }: { outcome: PuzzleOutcome; puzzle: PuzzleSample }) {
  // A theme like "mate in 2" or "fork" gives the answer away, so the puzzle's own tags wait until
  // it is solved or failed (the Set line still shows the filters the user chose).
  const tags = outcome === "pending" ? [] : [...puzzle.themes, ...puzzle.openingTags];
  if (!tags.length) return null;
  return (
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
  );
}

/** A "From my games" puzzle's game and difficulty, once it is over (nothing for other sets). */
function GamePuzzleSource({
  puzzle,
  onOpenGame
}: {
  puzzle: PuzzleSample;
  onOpenGame: (puzzle: GamePuzzle) => void;
}) {
  const gamePuzzle = gamePuzzleFor(puzzle);
  return gamePuzzle ? <GamePuzzleFacts puzzle={gamePuzzle} onOpenGame={onOpenGame} /> : null;
}

/** Where the puzzle comes from: the dataset it was drawn from and its source game. */
function PuzzleSource({
  puzzle,
  puzzleConfig
}: Pick<PanelProps, "puzzleConfig"> & { puzzle: PuzzleSample }) {
  // Play's Puzzle of the day says so where the set is named.
  const ofTheDay = puzzleConfig?.puzzleOfTheDayId === puzzle.id;
  const setLine = puzzleConfig
    ? ofTheDay
      ? "Puzzle of the day"
      : puzzleDatasetLabel(puzzle.sourceId, puzzle.sourceName)
    : null;
  if (!setLine && !puzzle.gameUrl) return null;
  return (
    <div className="grid gap-1.5">
      {setLine ? (
        <p className="min-w-0 text-xs leading-5 text-fg-muted">
          {ofTheDay ? null : <span className="text-fg-subtle">Set: </span>}
          {setLine}
        </p>
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
  );
}
