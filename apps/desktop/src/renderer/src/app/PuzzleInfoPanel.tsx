import { memo, useMemo } from "react";
import { ExternalLink, Loader2, Puzzle, Swords } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { positionStatus } from "@/lib/position-status";
import { sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { PuzzleExplanation } from "../features/puzzles/PuzzleExplanation";
import { explainOutcome } from "../features/puzzles/puzzle-explanation";
import {
  formatPuzzleTag,
  puzzleDatasetLabel,
  puzzleSetSummary
} from "../features/puzzles/puzzle-set";
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
        <PuzzleNextActions
          complete={complete}
          broken={broken}
          terminal={terminal}
          nextError={nextError}
          nextPending={nextPending}
          onNextPuzzle={onNextPuzzle}
          onPlayEngineFromHere={onPlayEngineFromHere}
        />
      ) : null}

      {explainKind ? (
        <PuzzleExplanation
          puzzle={puzzle}
          kind={explainKind}
          wrong={firstWrongMove}
          linkMoves={complete}
        />
      ) : null}

      <PuzzleSolution
        complete={complete}
        outcome={outcome}
        progressCount={progressCount}
        solution={solution}
      />

      <PuzzleThemes puzzle={puzzle} outcome={outcome} />

      <PuzzleSource puzzle={puzzle} puzzleConfig={puzzleConfig} onEditSet={onEditSet} />
    </section>
  );
}

/** The puzzle's number, with its rating and difficulty when the dataset has them. */
function PuzzleHeading({ puzzle }: { puzzle: PuzzleSample }) {
  return (
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
  );
}

/** What to do once the puzzle is over (or failed): the next one, or play the engine from here. */
function PuzzleNextActions({
  broken,
  complete,
  nextError,
  nextPending,
  onNextPuzzle,
  onPlayEngineFromHere,
  terminal
}: Pick<PanelProps, "nextError" | "nextPending" | "onNextPuzzle" | "onPlayEngineFromHere"> & {
  broken: boolean;
  complete: boolean;
  terminal: boolean;
}) {
  const over = complete || broken;
  return (
    <div className="grid animate-rise-in gap-2">
      {/* Finished or broken: on to the next one. Failed and unfinished: the next one is there to skip to. */}
      <Button
        type="button"
        variant={over ? "primary" : "outline"}
        className={over ? "h-10" : undefined}
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
          title={
            terminal ? "This position is already finished" : "Continue against the default engine"
          }
        >
          <Swords />
          Play engine from here
        </Button>
      ) : null}
      {nextError ? (
        <Notice tone="danger">{ipcErrorMessage(nextError) || nextError.message}</Notice>
      ) : null}
    </div>
  );
}

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

/** Where the puzzle comes from: the set it was drawn from (to edit) and its source game. */
function PuzzleSource({
  onEditSet,
  puzzle,
  puzzleConfig
}: Pick<PanelProps, "onEditSet" | "puzzleConfig"> & { puzzle: PuzzleSample }) {
  // Play's Puzzle of the day says so where the set is named (the set's filters draw the next ones).
  const ofTheDay = puzzleConfig?.puzzleOfTheDayId === puzzle.id;
  const setLine = puzzleConfig
    ? ofTheDay
      ? "Puzzle of the day"
      : puzzleSetSummary(puzzleConfig, puzzleDatasetLabel(puzzle.sourceId, puzzle.sourceName))
    : null;
  if (!setLine && !puzzle.gameUrl) return null;
  return (
    <div className="grid gap-1.5">
      {setLine ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <p className="min-w-0 text-xs leading-5 text-fg-muted">
            {ofTheDay ? null : <span className="text-fg-subtle">Set: </span>}
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
  );
}
