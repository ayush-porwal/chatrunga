import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { BroadcastRoundDetail } from "@chaturanga/shared/types/broadcast";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { GamePuzzle } from "@chaturanga/shared/types/game-puzzles";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameResult
} from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import type { BroadcastScreen, TournamentTarget } from "../features/broadcasts/navigation";
import { isLichessMode } from "../features/play/play-layout";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { PracticePreset } from "../features/repertoire/practice-setup";
import type { InsightsReviewTarget } from "../features/repertoire/insights/insights-actions";
import type { StudyOpenTarget } from "../features/repertoire/repertoire-chapters";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useLichessStore } from "../stores/lichess-store";
import { usePuzzleDraftStore } from "../stores/puzzle-draft-store";
import { useRepertoirePracticeStore } from "../stores/repertoire-practice-store";
import {
  confirmLeavingStaged,
  useRepertoireWorkspaceStore
} from "../stores/repertoire-workspace-store";
import { currentGame, type AppNavigation } from "./app-navigation";
import type { BoardCommands } from "./board-commands";
import type { BroadcastCommands } from "./broadcast-commands";
import type { PuzzleCommands } from "./puzzle-commands";
import type { RepertoireCommands } from "./repertoire-commands";
import type { RepertoireExtras } from "./useRepertoireRoute";
import { cancelActiveReview } from "./useReviewRunner";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";

/** The shell's commands, and the state its own commands (layout, dialogs, Back / Forward) change. */
type AppCommandSources = {
  nav: AppNavigation;
  board: BoardCommands;
  broadcast: BroadcastCommands;
  puzzles: PuzzleCommands;
  repertoire: RepertoireCommands;
  /** Back / Forward (useHistoryRestore); `busy` while a restore is still loading. */
  history: { go: (delta: -1 | 1) => Promise<void>; busy: { readonly current: boolean } };
  /** Focus mode is on (on a board view). */
  focused: boolean;
  setActionRailOpen: Dispatch<SetStateAction<boolean>>;
  setImportOpen: (open: boolean) => void;
  setGameReviewPickerOpen: (open: boolean) => void;
  setRepertoireExtras: Dispatch<SetStateAction<RepertoireExtras>>;
  startReview: () => Promise<void>;
};

/**
 * What the sidebar, titlebar, pages and dialogs ask the shell to do. Stable handler identities, so
 * the memoised sidebar / titlebar / pages skip unrelated renders; each runs the latest render's
 * command. Commands that would replace the board are guarded by a Lichess game being played.
 */
export function useAppCommands({
  nav,
  board,
  broadcast,
  puzzles,
  repertoire,
  history,
  focused,
  setActionRailOpen,
  setImportOpen,
  setGameReviewPickerOpen,
  setRepertoireExtras,
  startReview
}: AppCommandSources) {
  const { unlessOnlineGame, setFocusMode } = nav;
  const { unlessRepertoireBlocked } = repertoire;
  const closeAddToRepertoire = useAddToRepertoireStore((state) => state.close);
  // Play from here's Retry (its notice, when the chapter couldn't be saved first) runs the command
  // again as the latest render builds it; a stable callback can't name itself while it is built.
  const retryPlayFromStudy = useRef(() => {
    // Replaced once the commands below exist, before any notice can offer Retry.
  });

  /**
   * Leaving Study with staged moves (never saved) asks first: `run` goes ahead only when nothing
   * is staged or the user agrees to discard them (they go once the screen changes, so a navigation
   * that doesn't happen keeps them). `keepsChapter`: it stays in the open chapter (no question).
   */
  const leavingStudy =
    <A extends unknown[]>(run: (...args: A) => void, keepsChapter?: (...args: A) => boolean) =>
    (...args: A) => {
      if (nav.view === "repertoire-study" && !keepsChapter?.(...args) && !confirmLeavingStaged())
        return;
      run(...args);
    };

  // Before the rest: "Added to repertoire"'s notice opens the chapter through it.
  const openRepertoireStudy = useEventCallback(
    leavingStudy(
      (target: StudyOpenTarget) =>
        unlessRepertoireBlocked(
          target.stage ? "stage-response" : "open-study",
          () => void repertoire.openRepertoireStudy(target)
        ),
      (target) => target.chapterId === useRepertoireWorkspaceStore.getState().chapterId
    )
  );
  const on = {
    // "Add to…" another chapter (Study): the staged moves go along, so it opens without the leave
    // question; whether it opened (a failed save or a Lichess game in progress keeps Study).
    openChapterForStaged: useEventCallback((target: StudyOpenTarget) => {
      let opened = Promise.resolve(false);
      unlessRepertoireBlocked("open-study", () => {
        opened = repertoire.openRepertoireStudy(target);
      });
      return opened;
    }),
    // "Show sidebar" while focused brings the whole frame back (sidebar and panel).
    toggleSidebar: useEventCallback(() => {
      if (focused) {
        setFocusMode(false);
        setActionRailOpen(true);
      } else setActionRailOpen((open) => !open);
    }),
    settings: useEventCallback(leavingStudy(() => nav.openSettings(null))),
    commentarySettings: useEventCallback(leavingStudy(() => nav.openSettings("ai"))),
    openSettings: useEventCallback(
      leavingStudy((section: SettingsSectionId) => nav.openSettings(section))
    ),
    engineSettings: useEventCallback(leavingStudy(() => nav.openSettings("engines"))),
    back: useEventCallback(leavingStudy(() => void history.go(-1))),
    forward: useEventCallback(leavingStudy(() => void history.go(1))),
    settingsSectionViewed: useEventCallback((section: SettingsSectionId) =>
      nav.settingsSectionViewed(section)
    ),
    importedGame: useEventCallback(
      leavingStudy((imported: ImportedGame) =>
        unlessOnlineGame(() => board.loadImportedGame(imported))
      )
    ),
    beforePlayStart: useEventCallback(board.beforeEngineGame),
    play: useEventCallback(leavingStudy(() => nav.openFreshPlayPage())),
    freeBoard: useEventCallback(leavingStudy(() => unlessOnlineGame(board.startFreeBoard))),
    liveAnalysis: useEventCallback(leavingStudy(() => unlessOnlineGame(board.startLiveAnalysis))),
    stopLiveAnalysis: useEventCallback(board.stopLiveAnalysis),
    analyzePosition: useEventCallback(board.analyzeCurrentPosition),
    openReviewPicker: useEventCallback(() => unlessOnlineGame(() => setGameReviewPickerOpen(true))),
    closeReviewPicker: useEventCallback(() => setGameReviewPickerOpen(false)),
    openImportDialog: useEventCallback(() => setImportOpen(true)),
    closeImportDialog: useEventCallback(() => setImportOpen(false)),
    reviewGame: useEventCallback(
      leavingStudy((id: string) => unlessOnlineGame(() => void board.openSelectedGameReview(id)))
    ),
    // After a Lichess game: Play, in the Lichess mode it was played in (else Quick pairing).
    playLichess: useEventCallback(() => {
      const lichess = useLichessStore.getState();
      const mode = lichess.playOpponent;
      lichess.setPlayOpponent(mode && isLichessMode(mode) ? mode : "pool");
      nav.openFreshPlayPage();
    }),
    puzzles: useEventCallback(leavingStudy(() => unlessOnlineGame(() => nav.openPuzzlesPage()))),
    databases: useEventCallback(leavingStudy(() => nav.openDatabasesPage())),
    broadcasts: useEventCallback(leavingStudy(() => nav.openBroadcastsPage())),
    openBroadcastTournament: useEventCallback((target: TournamentTarget) =>
      nav.openBroadcastTournament(target)
    ),
    broadcastScreenChange: useEventCallback((screen: BroadcastScreen) =>
      nav.changeBroadcastScreen(screen)
    ),
    // A Lichess game of yours being played keeps the board.
    openBroadcastGame: useEventCallback((detail: BroadcastRoundDetail, gameId: string) =>
      unlessOnlineGame(() => void broadcast.openBroadcastGame(detail, gameId))
    ),
    // Databases → "Train with this dataset": Puzzles with that dataset chosen (other filters kept).
    trainWithDatabase: useEventCallback((databaseId: string) =>
      // A Lichess game on the board keeps it (like the Puzzles item).
      unlessOnlineGame(() => {
        usePuzzleDraftStore.getState().update({ databaseId });
        nav.openPuzzlesPage();
      })
    ),
    importPgn: useEventCallback(
      leavingStudy(() => unlessOnlineGame(() => void board.importPgnFile()))
    ),
    exportPgn: useEventCallback(() => void board.exportPgn()),
    toggleFocus: useEventCallback(() => setFocusMode((value) => !value)),
    exitFocus: useEventCallback(() => setFocusMode(false)),
    // Flip turns the board on screen: the repertoire boards keep their own orientation (grading
    // and the repertoire's colour never change with it).
    flipBoard: useEventCallback(() => {
      if (nav.view === "repertoire-study") useRepertoireWorkspaceStore.getState().flip();
      else if (nav.view === "repertoire-practice") useRepertoirePracticeStore.getState().flip();
      else currentGame().flip();
    }),
    openGame: useEventCallback((id: string) =>
      unlessOnlineGame(() => void board.openSavedGameById(id))
    ),
    rejoinSavedGame: useEventCallback((id: string) =>
      unlessOnlineGame(() => void board.rejoinSavedGame(id))
    ),
    solvePuzzleOfTheDay: useEventCallback((puzzle: PuzzleSample) =>
      unlessOnlineGame(() => void puzzles.solvePuzzleOfTheDay(puzzle))
    ),
    startReview: useEventCallback(() => void startReview()),
    stopReview: useEventCallback(() => void cancelActiveReview()),
    showGame: useEventCallback(() => nav.showGame()),
    startPuzzle: useEventCallback((config: PuzzleSessionConfig, puzzle: PuzzleSample) =>
      puzzles.startPuzzle(puzzle, { config })
    ),
    openGameFromLibrary: useEventCallback((id: string) =>
      unlessOnlineGame(() => void board.openSavedGameById(id))
    ),
    nextPuzzle: useEventCallback(puzzles.loadNextPuzzle),
    // A finished "From my games" puzzle's Open game: its game at that move (Back returns to the puzzle).
    openGamePuzzleGame: useEventCallback((puzzle: GamePuzzle) =>
      unlessOnlineGame(() => void board.openGamePuzzleGame(puzzle))
    ),
    playEngineFromPuzzle: useEventCallback(puzzles.playEngineFromCurrentPuzzlePosition),
    reviewCurrentGame: useEventCallback(() => void board.openSelectedGameReview("current")),
    reviewEngineGame: useEventCallback(() => void board.reviewFinishedEngineGame()),
    repertoireHub: useEventCallback(leavingStudy(() => repertoire.openRepertoireHub())),
    // A practice summary's Back to Practice / Back to Insights: the hub on that tab.
    repertoireHubTab: useEventCallback((tab: RepertoireHubTab) =>
      repertoire.openRepertoireHub("push", tab)
    ),
    openRepertoireStudy,
    // "Refresh this decision" (a game's opening comparison): a targeted queue that starts at once.
    // Back returns to the review left (its tab and move are committed first).
    refreshRepertoireDecision: useEventCallback(
      leavingStudy((repertoireId: string, positionKey: string) =>
        unlessRepertoireBlocked(
          "refresh-decision",
          () =>
            void repertoire.openRepertoirePractice(repertoireId, {
              preset: { mode: "review-due", positionKeys: [positionKey] }
            })
        )
      )
    ),
    repertoireStageApplied: useEventCallback(() =>
      setRepertoireExtras((extras) => ({ ...extras, stage: null }))
    ),
    // Practice (the hub, Home's "Review now"): a session starts at once with the practice settings.
    openRepertoirePractice: useEventCallback((repertoireId: string) =>
      unlessRepertoireBlocked(
        "open-practice",
        () => void repertoire.openRepertoirePractice(repertoireId)
      )
    ),
    resumeRepertoirePractice: useEventCallback(
      ({ repertoireId, sessionId }: { repertoireId: string; sessionId: string }) =>
        unlessRepertoireBlocked(
          "resume-practice",
          () => void repertoire.openRepertoirePractice(repertoireId, { sessionId })
        )
    ),
    // Study's Practice: the practice settings, a rehearsal of lines playing the open chapter.
    practiceFromStudy: useEventCallback(
      leavingStudy((repertoireId: string, chapterId: string) =>
        unlessRepertoireBlocked(
          "open-practice",
          () => void repertoire.openRepertoirePractice(repertoireId, { preset: { chapterId } })
        )
      )
    ),
    // "Rehearse again", "Retry missed" (a summary) and another line's chapter: the session starts
    // at once, as a new step (Back returns to where it was asked for).
    rehearseRepertoire: useEventCallback((repertoireId: string, preset: PracticePreset) =>
      unlessRepertoireBlocked("open-practice", () => {
        useRepertoirePracticeStore.getState().reset();
        void repertoire.openRepertoirePractice(repertoireId, { preset });
      })
    ),
    // A chapter / repertoire gone since (deleted, or a stale history entry): the hub, with why.
    repertoireMissing: useEventCallback((message: string) => {
      useAppNoticeStore.getState().show(message);
      repertoire.openRepertoireHub("replace");
    }),
    repertoireTabChange: useEventCallback((tab: StudyTab) =>
      setRepertoireExtras((extras) => ({ ...extras, tab }))
    ),
    // Moving through the tree, switching tabs or flipping updates the entry; it never adds one.
    // Not while Back / Forward is showing a screen: the current entry is still the one being left.
    repertoirePositionChanged: useEventCallback(() => {
      if (nav.view === "repertoire-study" && !history.busy.current)
        nav.record("replace", nav.historyEntry("repertoire-study"));
    }),
    // A repertoire source link: the saved game on the board at the linked move (no move: the
    // game's start, even when the game is already open at a later move).
    openGameAtNode: useEventCallback(
      leavingStudy((gameId: string, nodeId: string | null) =>
        unlessOnlineGame(() => void board.openSavedGameById(gameId, nodeId ?? "root"))
      )
    ),
    closeAddToRepertoire: useEventCallback(closeAddToRepertoire),
    // Added: the dialog closes and the notice offers the chapter (Back returns here).
    addedToRepertoire: useEventCallback((result: AddFromGameResult) => {
      closeAddToRepertoire();
      const target = {
        repertoireId: result.repertoire.id,
        chapterId: result.chapter.id,
        nodeId: REPERTOIRE_ROOT_NODE_ID
      };
      useAppNoticeStore
        .getState()
        .show(`Added to ${result.repertoire.name} › ${result.chapter.title}`, {
          tone: "success",
          action: { label: "Open chapter", onSelect: () => openRepertoireStudy(target) }
        });
    }),
    repertoirePracticeStarted: useEventCallback(repertoire.practiceSessionStarted),
    repertoirePracticeAgain: useEventCallback(() =>
      unlessRepertoireBlocked("open-practice", repertoire.practiceAgain)
    ),
    // Only Study offers it: staged moves are asked about first.
    playFromStudy: useEventCallback(() => {
      if (!confirmLeavingStaged()) return;
      unlessRepertoireBlocked(
        "play-from-here",
        () => void repertoire.playFromStudy(() => retryPlayFromStudy.current())
      );
    }),
    returnToRepertoire: useEventCallback(() =>
      unlessRepertoireBlocked("return-to-repertoire", repertoire.returnToRepertoire)
    ),
    reviewHandoffOpening: useEventCallback(() =>
      unlessRepertoireBlocked("review-opening", () => void repertoire.reviewHandoffOpening())
    ),
    // Insights' Review game (a Lichess game being played keeps the board), and Back to Insights.
    reviewGameFromInsights: useEventCallback((target: InsightsReviewTarget) =>
      unlessOnlineGame(() => void repertoire.reviewFromInsights(target))
    ),
    backToInsights: useEventCallback(() => repertoire.backToInsights())
  };
  useLayoutEffect(() => {
    retryPlayFromStudy.current = on.playFromStudy;
  }, [on.playFromStudy]);
  return on;
}

export type AppCommands = ReturnType<typeof useAppCommands>;
