import { useRef } from "react";
import type { SavedGame } from "@chaturanga/shared/types/chess";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEventCallback } from "@/lib/use-event-callback";
import { openSavedGame, savedReview } from "../features/game/saved-game";
import { LIVE_GAME_NOTICE } from "../features/repertoire/handoffs";
import { isMissingTargetError } from "../features/repertoire/repertoire-model";
import { useAnalysisStore } from "../stores/analysis-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import { useHistoryStore, type BoardSnapshot, type HistoryEntry } from "../stores/history-store";
import { useLichessStore } from "../stores/lichess-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import { useReviewStore } from "../stores/review-store";
import { continuedPuzzleSet, planBoardRestore, replacesLiveBoard, type BoardRestore } from "./history-navigation";
import type { PuzzleSetSnapshot } from "./puzzle-session-controller";
import type { SideTab } from "./side-tabs";
import { holdUntilChanged } from "./useGameAutosave";

/**
 * Back / Forward: putting a history entry's screen back, which may wait for a saved game or a
 * study draft's save, and the guards around it (a Lichess game being played keeps the board, a
 * newer navigation wins over a restore still loading, a deleted game's entry is dropped with a
 * notice). App supplies the commands that show each screen (`NavigationShell`); this module
 * decides which to run and when, so it can be tested without the shell.
 */

/**
 * The shell's side of a restore: App's navigation counter and the commands that show a screen.
 * None of them records history: the index moves here, once the screen is shown.
 */
export type NavigationShell = {
  /**
   * Bumped by every navigation (App's `latestNavigation`). A restore that finishes loading after a
   * newer navigation (another Back, a sidebar click, a Lichess game starting) is dropped.
   */
  navigation: { current: number };
  /** Saves the screen being left as it is now (so Forward returns to it as it was left). */
  commitCurrent: () => void;
  /** The board on its current tab: where a Lichess game being played brings you back. */
  showLiveGame: () => void;
  showHome: () => void;
  showSettings: (section: Extract<HistoryEntry, { view: "settings" }>["section"]) => void;
  openPlay: () => void;
  openPuzzles: () => void;
  openDatabases: () => void;
  openRepertoireHub: () => void;
  /**
   * Opens a study chapter. False when it didn't: the chapter being left couldn't be saved (the
   * notice says so) or a newer navigation won meanwhile. A chapter deleted since opens and then
   * hands back to the hub from the page (with a notice).
   */
  openRepertoireStudy: (entry: Extract<HistoryEntry, { view: "repertoire-study" }>) => Promise<boolean>;
  /** Opens practice (a session, or the setup); false as for `openRepertoireStudy`. */
  openRepertoirePractice: (repertoireId: string, sessionId: string | null) => Promise<boolean>;
  showGame: (tab: SideTab) => void;
  /** The review screen for the board now loaded, on the entry's tab and opening side. */
  showGameReview: (entry: Extract<HistoryEntry, { view: "game-review" }>) => void;
  startPuzzle: (puzzle: Extract<BoardRestore, { kind: "puzzle" }>) => void;
  /** A saved game from the library; rejects when it's gone (or can't be read). */
  getSavedGame: (gameId: string) => Promise<SavedGame>;
  stopEngineWork: (options?: { stopSearch?: boolean; keepReview?: boolean }) => void;
  clearPuzzleSession: () => void;
  /** Ends the puzzle set unless the board is a game played on from its puzzle (it keeps Next puzzle). */
  releasePuzzleSession: () => void;
  /** Brings a puzzle set back with the game now on the board, played on from its puzzle. */
  resumePuzzleSet: (set: PuzzleSetSnapshot) => void;
  /** Ends the board's search, review and puzzle set before another board replaces it. */
  endBoardActivity: () => void;
  defaultEngineId: string | null;
  exitFocus: () => void;
};

/**
 * How a restore ended: "shown" (the index moves to it), "gone" (its game was deleted: the entry is
 * dropped), "failed" (couldn't be loaded now: you stay, the entry is kept) or "dropped" (a newer
 * navigation won, or a study draft couldn't be saved: you stay).
 */
export type RestoreOutcome = "shown" | "gone" | "failed" | "dropped";

/**
 * The restore still loading, and the navigation it waits on. A newer navigation drops it (it
 * checks the counter once its game or draft save is in), so it only holds Back / Forward while
 * it's still the latest.
 */
export type PendingRestore = { current: { waitingOn: number } | null };

/** A restore is still loading and nothing newer replaced it: Back / Forward wait for it. */
export function restoreLoading(pending: PendingRestore, navigation: { current: number }): boolean {
  return Boolean(pending.current && pending.current.waitingOn === navigation.current);
}

/** Back (-1) / Forward (+1). */
export async function goHistory(delta: -1 | 1, shell: NavigationShell, pending: PendingRestore): Promise<void> {
  if (restoreLoading(pending, shell.navigation)) return;
  const history = useHistoryStore.getState();
  const targetIndex = history.index + delta;
  const target = history.entries[targetIndex];
  if (!target) return;
  // A Lichess game being played keeps the board: back to it, with why, and the index stays.
  const live = useLichessStore.getState().live;
  if (live && !live.over && replacesLiveBoard(target, live.id)) {
    shell.showLiveGame();
    useGameStore.getState().setMatchFeedback(LIVE_GAME_NOTICE);
    return;
  }
  shell.commitCurrent();
  const restore = restoreEntry(target, shell);
  // The restore has taken its navigation number (everything up to its first wait has run): it
  // is dropped when that number moves on, and a newer press may go ahead.
  const mine = { waitingOn: shell.navigation.current };
  pending.current = mine;
  try {
    const outcome = await restore;
    // Only once the screen is shown: the index always names what's on screen.
    if (outcome === "shown") useHistoryStore.getState().moveTo(targetIndex);
    // A game deleted since: forget its entry (the next press goes past it).
    else if (outcome === "gone") useHistoryStore.getState().removeAt(targetIndex);
  } finally {
    // A newer press's restore may be the pending one by now.
    if (pending.current === mine) pending.current = null;
  }
}

/** Shows a history entry's screen (see RestoreOutcome). */
export async function restoreEntry(entry: HistoryEntry, shell: NavigationShell): Promise<RestoreOutcome> {
  switch (entry.view) {
    case "home":
      shell.showHome();
      return "shown";
    case "settings":
      shell.showSettings(entry.section);
      return "shown";
    case "play":
      if (entry.opponent) useLichessStore.getState().setPlayOpponent(entry.opponent);
      shell.openPlay();
      return "shown";
    case "puzzles":
      shell.openPuzzles();
      return "shown";
    case "databases":
      shell.openDatabases();
      return "shown";
    case "game": {
      const outcome = await restoreBoard(entry.board, shell);
      if (outcome === "restored") shell.showGame(entry.board.tab);
      return outcome === "restored" ? "shown" : outcome;
    }
    case "game-review": {
      // The review running for this game keeps going (left for a repertoire screen, say).
      const outcome = await restoreBoard(entry.board, shell, { keepReview: true });
      if (outcome !== "restored") return outcome;
      const request = shell.navigation.current;
      // The review may not be loaded (the board was replaced while away): bring the saved one back.
      if (entry.board.gameId && !useReviewStore.getState().review) {
        const saved = await shell.getSavedGame(entry.board.gameId).catch(() => null);
        if (request !== shell.navigation.current) return "dropped";
        if (saved?.review) useReviewStore.getState().loadReview(savedReview(saved), saved.reviews ?? []);
      }
      useGameStore.getState().setMode("freeplay");
      shell.showGameReview(entry);
      return "shown";
    }
    case "repertoire-hub":
      shell.openRepertoireHub();
      return "shown";
    case "repertoire-study":
      // A chapter deleted since falls back to the hub from the page (with a notice).
      return (await shell.openRepertoireStudy(entry)) ? "shown" : "dropped";
    case "repertoire-practice":
      // A session that can't resume offers a new one on the page; nothing is graded on restore.
      return (await shell.openRepertoirePractice(entry.repertoireId, entry.sessionId)) ? "shown" : "dropped";
  }
}

/**
 * Puts a history entry's board back: "restored" (the caller shows it), "shown" (already on
 * screen: the live Lichess game, or a restarted puzzle), or as RestoreOutcome. A game that can't
 * come back says why above whichever page is open (the board's own status line is only on the
 * board). `keepReview`: a running review of the same game isn't cancelled.
 */
export async function restoreBoard(
  snapshot: BoardSnapshot,
  shell: NavigationShell,
  { keepReview = false }: { keepReview?: boolean } = {}
): Promise<"restored" | RestoreOutcome> {
  const request = ++shell.navigation.current;
  const plan = planBoardRestore(snapshot);
  if (plan.kind === "live") {
    shell.showGame(snapshot.tab);
    return "shown";
  }
  if (plan.kind === "puzzle") {
    // Its set again, still excluding every puzzle the set has shown (since this entry too).
    shell.startPuzzle(plan);
    return "shown";
  }
  // A game played on from a puzzle comes back with its set (and so its Next puzzle).
  const continuedSet = continuedPuzzleSet(snapshot);
  if (plan.kind === "saved") {
    const loaded = await loadSavedGame(shell, plan.gameId);
    if (request !== shell.navigation.current) return "dropped";
    if (loaded.kind === "gone") {
      useAppNoticeStore.getState().show("That game was deleted.");
      return "gone";
    }
    if (loaded.kind === "failed") {
      useAppNoticeStore.getState().show(`That game couldn't be opened: ${loaded.message}`);
      return "failed";
    }
    shell.stopEngineWork();
    shell.clearPuzzleSession();
    openSavedGame(loaded.game);
  } else if (plan.kind === "session") {
    shell.endBoardActivity();
    useGameStore.getState().loadGame(plan.session);
    if (snapshot.held) holdUntilChanged();
  } else {
    shell.stopEngineWork({ stopSearch: snapshot.mode !== "analysis", keepReview });
    // The same game: one played on from a puzzle keeps its set (Next puzzle).
    if (!continuedSet) shell.releasePuzzleSession();
  }
  if (continuedSet) shell.resumePuzzleSet(continuedSet);
  useGameStore.getState().restoreView(snapshot);
  if (snapshot.mode === "analysis") {
    const analysis = useAnalysisStore.getState();
    if (shell.defaultEngineId && !analysis.activeEngineId) analysis.setActiveEngine(shell.defaultEngineId);
    // The search was stopped while away; the position may be the same, so ask for it again (the
    // board's own search: a study's engine panel left on the way hands the engine back to it).
    useAnalysisStore.getState().restartBoardSearch();
  }
  shell.exitFocus();
  return "restored";
}

/**
 * A saved game for a restore. Only "not found" means it was deleted (its entry is dropped); any
 * other error keeps the entry, so a later Back can still reach it.
 */
async function loadSavedGame(
  shell: NavigationShell,
  gameId: string
): Promise<{ kind: "loaded"; game: SavedGame } | { kind: "gone" } | { kind: "failed"; message: string }> {
  try {
    return { kind: "loaded", game: await shell.getSavedGame(gameId) };
  } catch (error) {
    const message = ipcErrorMessage(error);
    return isMissingTargetError(message) ? { kind: "gone" } : { kind: "failed", message: message || "unknown error" };
  }
}

/**
 * Before another chapter or practice replaces the open study chapter: its draft is saved first,
 * with the prompt, hint, feedback and pause changes still unsaved (pending, or failed) even when
 * the chapter itself is saved or none is open. True to go on (nothing to save, or saved). False to
 * stay: the save failed (`failure` is shown; the draft stays open with its error and Retry) or a
 * newer navigation (`request` is no longer the latest) took over meanwhile. Which repertoires'
 * decision changes hold it back is the flush's choice. `keepChapterId`: the chapter being opened
 * (its own draft stays open, nothing is left).
 */
export async function saveStudyDraftFirst({
  request,
  navigation,
  flush,
  failure,
  keepChapterId = null
}: {
  request: number;
  navigation: { current: number };
  flush: () => Promise<boolean>;
  /** The notice when the draft stays unsaved (read once the flush settled). */
  failure: string | (() => string);
  keepChapterId?: string | null;
}): Promise<boolean> {
  const draft = useRepertoireWorkspaceStore.getState();
  if (draft.chapterId && draft.chapterId === keepChapterId) return true;
  const chapterUnsaved = draft.chapterId !== null && (draft.dirty || draft.saveState.status !== "idle");
  if (!chapterUnsaved && Object.keys(draft.decisionDrafts).length === 0) return true;
  const saved = await flush();
  if (request !== navigation.current) return false;
  if (!saved) {
    useAppNoticeStore.getState().show(typeof failure === "string" ? failure : failure());
    return false;
  }
  return true;
}

/**
 * Back / Forward for the shell: `go(-1)` / `go(1)` with a stable identity (it runs with the
 * latest render's commands), and `busy` while a restore is still loading (the current entry is
 * still the one being left, so nothing may replace it).
 */
export function useHistoryRestore(shell: NavigationShell): { go: (delta: -1 | 1) => Promise<void>; busy: { readonly current: boolean } } {
  const pending = useRef<PendingRestore["current"]>(null);
  const go = useEventCallback((delta: -1 | 1) => goHistory(delta, shell, pending));
  return {
    go,
    busy: {
      get current() {
        return restoreLoading(pending, shell.navigation);
      }
    }
  };
}
