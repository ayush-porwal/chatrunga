import { Puzzle, Swords } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/notice";
import { sectionTitle } from "@/lib/ui";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";

type PuzzleFeedbackKind = "idle" | "correct" | "wrong" | "complete";

/** Active-puzzle section shown atop the Moves tab of the board workspace panel. */
export function PuzzleInfoPanel({
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
}: {
  feedback: string | null;
  feedbackKind: PuzzleFeedbackKind;
  lastExpectedMove: string | null;
  nextError: Error | null;
  nextPending: boolean;
  onNextPuzzle: () => void;
  onPlayEngineFromHere: () => void;
  puzzle: PuzzleSample;
  puzzleConfig: PuzzleSessionConfig | null;
  solutionIndex: number;
  terminal: boolean;
}) {
  const solved = feedbackKind === "complete";
  const wrong = feedbackKind === "wrong";
  const progressCount = solved
    ? puzzle.solutionMoves.length
    : Math.min(solutionIndex, puzzle.solutionMoves.length);
  const meta = [
    puzzle.sourceName,
    puzzle.rating ? String(puzzle.rating) : null,
    puzzle.difficulty ? `difficulty ${puzzle.difficulty}` : null
  ]
    .filter(Boolean)
    .join(" · ");
  const tags = [...puzzle.themes, ...puzzle.openingTags].slice(0, 10);

  return (
    <section className="grid shrink-0 gap-3 border-b border-line-subtle pb-3" aria-label="Puzzle">
      <div className="grid min-w-0 gap-0.5">
        <h2 className={sectionTitle}>Puzzle #{puzzle.id}</h2>
        {meta ? <p className="truncate text-xs text-fg-muted">{meta}</p> : null}
      </div>

      <Notice
        tone={wrong ? "danger" : solved || feedbackKind === "correct" ? "success" : "info"}
        icon={feedbackKind === "idle" ? <Puzzle /> : undefined}
        action={
          <Badge className="font-mono" title="Solution progress">
            {progressCount} / {puzzle.solutionMoves.length}
          </Badge>
        }
      >
        {feedback ?? "Find the best move."}
        {wrong && lastExpectedMove ? <span className="sr-only"> Expected move: {lastExpectedMove}.</span> : null}
      </Notice>

      {solved ? (
        <div className="grid gap-2">
          <Button type="button" variant="primary" disabled={nextPending} onClick={onNextPuzzle}>
            <Puzzle />
            {nextPending ? "Finding next…" : "Next matching puzzle"}
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
        <Disclosure title="Show solution">
          <p className="font-mono text-xs leading-5 text-fg">{puzzle.solutionMoves.join(" ")}</p>
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
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function puzzleFilterChips(config: PuzzleSessionConfig): string[] {
  if (config.mode === "lichess-puzzle") {
    return [
      `rating ${config.lichess.ratingMin}-${config.lichess.ratingMax}`,
      `popularity ${config.lichess.popularityMin}+`,
      `side ${config.lichess.side}`,
      ...(config.lichess.themes.length ? config.lichess.themes : ["any theme"]),
      ...(config.lichess.openings.length ? config.lichess.openings : []),
      ...(config.lichess.lengths.length ? config.lichess.lengths : [])
    ].slice(0, 12);
  }
  return [
    `difficulty ${config.position.difficultyMin}-${config.position.difficultyMax}`,
    ...(config.position.tags.length ? config.position.tags : ["any tag"])
  ].slice(0, 12);
}
