import {
  GAME_PUZZLE_SOURCES,
  type GamePuzzleGenerationPhase,
  type GamePuzzleQueueStatus,
  type GamePuzzleSummary
} from "@chaturanga/shared/types/game-puzzles";
import { GAME_PUZZLE_SOURCE_LABELS } from "../puzzles/game-puzzle-set";
import type { DatabaseFact } from "./database-card";

/** The "My games" card's facts strip: games, games processed, puzzles found, puzzles due. */
export function myGamesFacts(summary: GamePuzzleSummary): DatabaseFact[] {
  const sources = GAME_PUZZLE_SOURCES.map((source) => summary.sources[source]);
  const sum = (pick: (source: (typeof sources)[number]) => number) =>
    sources.reduce((total, source) => total + pick(source), 0);
  return [
    { label: "Games", value: sum((source) => source.games).toLocaleString() },
    { label: "Processed", value: sum((source) => source.processed).toLocaleString() },
    { label: "Puzzles", value: summary.puzzles.toLocaleString() },
    { label: "Due", value: summary.due.toLocaleString() }
  ];
}

/** Games per source, the ones with games only: "Lichess 120 · Chess.com 40" (null with none). */
export function myGamesSourcesLine(summary: GamePuzzleSummary): string | null {
  const parts = GAME_PUZZLE_SOURCES.filter((source) => summary.sources[source].games > 0).map(
    (source) =>
      `${GAME_PUZZLE_SOURCE_LABELS[source]} ${summary.sources[source].games.toLocaleString()}`
  );
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Why Generate puzzles can't run, and where that is fixed (Settings → an account, or Engines):
 * no games, no game played by a connected account, no default engine, or Lc0 as the default.
 * `engine-failed`: the queue stopped because its engine won't start ({@link myGamesNote}).
 */
export type MyGamesBlocker = {
  kind: "no-games" | "no-account" | "engine-missing" | "lc0" | "engine-failed";
  message: string;
  settings: "lichess" | "engines";
};

export function myGamesBlocker(summary: GamePuzzleSummary): MyGamesBlocker | null {
  const sources = GAME_PUZZLE_SOURCES.map((source) => summary.sources[source]);
  if (!sources.some((source) => source.games > 0))
    return {
      kind: "no-games",
      message: "No games yet. Connect your Lichess or Chess.com account to bring your games in.",
      settings: "lichess"
    };
  if (!sources.some((source) => source.eligible > 0))
    return {
      kind: "no-account",
      message:
        "None of your games were played by a connected account. Connect your Lichess or Chess.com account.",
      settings: "lichess"
    };
  if (summary.engine === "missing")
    return {
      kind: "engine-missing",
      message: "Finding puzzles needs a chess engine. Add one in Settings.",
      settings: "engines"
    };
  if (summary.engine === "lc0")
    return {
      kind: "lc0",
      message: "Finding puzzles needs a UCI engine such as Stockfish as the default, not Lc0.",
      settings: "engines"
    };
  return null;
}

/**
 * The note the card shows: its blocker, else why the queue stopped with games left (its engine
 * won't start) pointing at Settings → Engines. The blocker already says when it is missing.
 */
export function myGamesNote(
  blocker: MyGamesBlocker | null,
  status: GamePuzzleQueueStatus | undefined
): MyGamesBlocker | null {
  if (blocker || !status?.problem) return blocker;
  return { kind: "engine-failed", message: status.problem, settings: "engines" };
}

/** Held with games left, paused or stopped by its engine: Resume carries on (or tries again). */
export function queueHeld(status: GamePuzzleQueueStatus): boolean {
  return status.paused || status.problem !== null;
}

/** The queue has games left (running, waiting or paused). */
export function queueActive(status: GamePuzzleQueueStatus | undefined): boolean {
  return Boolean(status && (status.current !== null || status.done < status.total));
}

const PHASE_LABELS: Record<GamePuzzleGenerationPhase, string> = {
  scan: "Scanning positions",
  find: "Finding candidates",
  check: "Checking candidates"
};

/**
 * The queue's progress as the card shows it: "Game 3 of 20", the game being worked on and its
 * step ("Magnus – Hikaru · Checking candidates 4/12"), and the bar's percentage (games done).
 * Paused, stopped (its engine is missing or won't start), or waiting while the engine is in use
 * elsewhere, says so instead of the step.
 */
export function queueProgress(status: GamePuzzleQueueStatus): {
  headline: string;
  detail: string | null;
  percent: number;
} {
  const total = Math.max(status.total, 1);
  const position = Math.min(status.done + (status.current ? 1 : 0), status.total);
  const current = status.current;
  const players = current ? `${current.white ?? "?"} – ${current.black ?? "?"}` : null;
  const step = queueStep(status);
  return {
    headline: `Game ${Math.max(position, 1)} of ${status.total}`,
    detail: [players, step].filter((part): part is string => part !== null).join(" · ") || null,
    percent: Math.round((status.done / total) * 100)
  };
}

function queueStep(status: GamePuzzleQueueStatus): string | null {
  if (status.paused) return "Paused";
  if (status.problem !== null) return "Stopped";
  if (status.waitingForEngine) return "Waiting while the engine is in use";
  const progress = status.current?.progress;
  return progress ? `${PHASE_LABELS[progress.phase]} ${progress.done}/${progress.total}` : null;
}
