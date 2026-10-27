import { SquareArrowOutUpRight } from "lucide-react";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GAME_PUZZLE_KIND_LABELS,
  gamePuzzleChanceLine,
  gamePuzzleDifficulty,
  gamePuzzleGameLine
} from "./game-puzzle-set";

/**
 * A finished "From my games" puzzle: its kind (and the kinds it is also tagged with), the game it
 * comes from, its difficulty and how often players at the user's rating find it, and Open game.
 * Shown only once the puzzle is over: the kind and the game would hint at the answer before.
 */
export function GamePuzzleFacts({
  puzzle,
  onOpenGame
}: {
  puzzle: GamePuzzle;
  onOpenGame: (puzzle: GamePuzzle) => void;
}) {
  const difficulty = gamePuzzleDifficulty(puzzle);
  const chance = gamePuzzleChanceLine(puzzle);
  return (
    <div className="grid animate-fade-in gap-2" role="group" aria-label="From your game">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-fg">
          {GAME_PUZZLE_KIND_LABELS[puzzle.kind]}
        </span>
        {puzzle.tags.map((tag) => (
          <Badge key={tag}>{GAME_PUZZLE_KIND_LABELS[tag]}</Badge>
        ))}
      </div>
      <p className="text-xs leading-5 text-fg-muted">{gamePuzzleGameLine(puzzle)}</p>
      {difficulty || chance ? (
        <p className="text-xs leading-5 text-fg-muted">
          {[difficulty ? `Difficulty ${difficulty}` : null, chance].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onOpenGame(puzzle)}
      >
        <SquareArrowOutUpRight />
        Open game
      </Button>
    </div>
  );
}
