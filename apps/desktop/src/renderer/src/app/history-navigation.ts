import { openingSideFor, type OpeningSide } from "../features/game-review/opening-comparison";
import type { ReviewTab } from "../features/game-review/review-utils";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useGameStore } from "../stores/game-store";
import { useHistoryStore, type BoardSnapshot, type HistoryEntry } from "../stores/history-store";
import { useLichessStore } from "../stores/lichess-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import type { AppView, RepertoireScreen } from "./AppPages";
import type { SideTab } from "./GameWorkspace";

/**
 * Back / Forward: what a history entry captures of the screen being left, and how its board is
 * put back. App owns the navigation itself (which views to show, loading saved games); this
 * module owns the snapshots and the decisions, so they can be tested without the shell.
 */

/** "push" adds a step to Back / Forward, "replace" swaps the current one, "none" records nothing. */
export type HistoryMode = "push" | "replace" | "none";

/** The shell's state a history entry records along with the stores. */
export type HistoryContext = {
  /** The workspace's side tab. */
  tab: SideTab;
  reviewTab: ReviewTab;
  /** The Opening tab's picked side (kept with the review of its own game). */
  openingSide: OpeningSide | null;
  /** The Settings section being read (else where Settings opened). */
  settingsSection: SettingsSectionId | null;
  /** The puzzle set the board's puzzle belongs to. */
  puzzleConfig: PuzzleSessionConfig | null;
  /** The repertoire screen shown (from the route and App's extras). */
  repertoireScreen: RepertoireScreen | null;
};

/** The board as it is now, for a history entry. */
export function captureBoard(tab: SideTab, puzzleConfig: PuzzleSessionConfig | null): BoardSnapshot {
  const game = useGameStore.getState();
  const puzzle = game.mode === "puzzle" ? usePuzzleStore.getState().activePuzzle : null;
  return {
    gameId: game.gameId,
    // Nothing to reload an unsaved game from: keep it whole.
    session: game.gameId ? null : game.toSession(),
    currentNodeId: game.currentNodeId,
    mode: game.mode,
    source: game.source,
    engineSide: game.engineSide,
    orientation: game.orientation,
    gameOutcome: game.gameOutcome,
    tab,
    puzzle: puzzle ? { sample: puzzle, config: puzzleConfig } : null,
    lichessGameId: game.mode === "online" ? (useLichessStore.getState().live?.id ?? null) : null
  };
}

/** The entry for `view` as it is now. */
export function captureEntry(view: AppView, context: HistoryContext): HistoryEntry {
  switch (view) {
    case "settings":
      return { view, section: context.settingsSection };
    case "play": {
      // The tab actually shown (an unchosen tab follows the account, which may change later).
      const lichess = useLichessStore.getState();
      const connected = Boolean(lichess.status.account) && !lichess.status.tokenRejected;
      return { view, opponent: lichess.playOpponent ?? (connected ? "lichess" : "engine") };
    }
    case "game":
      return { view, board: captureBoard(context.tab, context.puzzleConfig) };
    case "game-review":
      return {
        view,
        board: captureBoard("notation", context.puzzleConfig),
        tab: context.reviewTab,
        compareColor: openingSideFor(context.openingSide, useGameStore.getState().board)
      };
    case "repertoire-study": {
      const screen = context.repertoireScreen;
      if (screen?.view !== "repertoire-study") return { view: "repertoire-hub" };
      const draft = useRepertoireWorkspaceStore.getState();
      const open = draft.repertoireId === screen.repertoireId && draft.chapterId === screen.chapterId;
      return {
        view,
        repertoireId: screen.repertoireId,
        chapterId: screen.chapterId,
        nodeId: open ? draft.selectedNodeId : screen.nodeId,
        tab: screen.tab,
        orientation: open ? draft.orientation : screen.orientation
      };
    }
    case "repertoire-practice": {
      const screen = context.repertoireScreen;
      if (screen?.view !== "repertoire-practice") return { view: "repertoire-hub" };
      return { view, repertoireId: screen.repertoireId, sessionId: screen.sessionId };
    }
    default:
      return { view };
  }
}

export function recordHistory(mode: HistoryMode, entry: HistoryEntry): void {
  if (mode === "push") useHistoryStore.getState().push(entry);
  else if (mode === "replace") useHistoryStore.getState().replaceCurrent(entry);
}

/** Whether showing `entry` would take the board from the Lichess game being played. */
export function replacesLiveBoard(entry: HistoryEntry, liveGameId: string): boolean {
  if (entry.view === "puzzles") return true; // opening Puzzles puts the board in puzzle mode
  if (entry.view === "game" || entry.view === "game-review") return entry.board.lichessGameId !== liveGameId;
  return false;
}

/**
 * How a snapshot's board comes back:
 * - "live": it's the Lichess game still being played, already on the board;
 * - "puzzle": its puzzle starts again (never restored mid-solution);
 * - "saved": another saved game, loaded from the library (it may have been deleted since);
 * - "session": an unsaved game, loaded from the snapshot itself;
 * - "same": the game already on the board, only its view is restored.
 */
export type BoardRestore =
  | { kind: "live" }
  | { kind: "puzzle"; sample: NonNullable<BoardSnapshot["puzzle"]>["sample"]; config: PuzzleSessionConfig }
  | { kind: "saved"; gameId: string }
  | { kind: "session"; session: NonNullable<BoardSnapshot["session"]> }
  | { kind: "same" };

export function planBoardRestore(snapshot: BoardSnapshot): BoardRestore {
  // A Lichess game still being played can only be the one on the board now (Back checked that).
  const live = useLichessStore.getState().live;
  if (snapshot.lichessGameId && live && !live.over && snapshot.lichessGameId === live.id) return { kind: "live" };
  if (snapshot.puzzle) {
    return { kind: "puzzle", sample: snapshot.puzzle.sample, config: snapshot.puzzle.config as PuzzleSessionConfig };
  }
  if (snapshot.gameId && snapshot.gameId !== useGameStore.getState().gameId) return { kind: "saved", gameId: snapshot.gameId };
  if (!snapshot.gameId && snapshot.session) return { kind: "session", session: snapshot.session };
  return { kind: "same" };
}
