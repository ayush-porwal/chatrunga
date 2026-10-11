import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameResult
} from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import { isLichessMode } from "../features/play/play-layout";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { PracticePreset } from "../features/repertoire/practice-setup";
import type { StudyOpenTarget } from "../features/repertoire/repertoire-chapters";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useLichessStore } from "../stores/lichess-store";
import { draftFromSessionConfig, usePuzzleDraftStore } from "../stores/puzzle-draft-store";
import { useRepertoirePracticeStore } from "../stores/repertoire-practice-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import { currentGame, type AppNavigation } from "./app-navigation";
import type { BoardCommands } from "./board-commands";
import type { PuzzleCommands } from "./puzzle-commands";
import type { RepertoireCommands } from "./repertoire-commands";
import type { RepertoireExtras } from "./useRepertoireRoute";
import { cancelActiveReview } from "./useReviewRunner";

/** The shell's commands, and the state its own commands (layout, dialogs, Back / Forward) change. */
type AppCommandSources = {
  nav: AppNavigation;
  board: BoardCommands;
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

  // Before the rest: "Added to repertoire"'s notice opens the chapter through it.
  const openRepertoireStudy = useEventCallback((target: StudyOpenTarget) =>
    unlessRepertoireBlocked(
      target.stage ? "stage-response" : "open-study",
      () => void repertoire.openRepertoireStudy(target)
    )
  );
  const on = {
    // "Show sidebar" while focused brings the whole frame back (sidebar and panel).
    toggleSidebar: useEventCallback(() => {
      if (focused) {
        setFocusMode(false);
        setActionRailOpen(true);
      } else setActionRailOpen((open) => !open);
    }),
    settings: useEventCallback(() => nav.openSettings(null)),
    commentarySettings: useEventCallback(() => nav.openSettings("ai")),
    openSettings: useEventCallback((section: SettingsSectionId) => nav.openSettings(section)),
    engineSettings: useEventCallback(() => nav.openSettings("engines")),
    back: useEventCallback(() => void history.go(-1)),
    forward: useEventCallback(() => void history.go(1)),
    settingsSectionViewed: useEventCallback((section: SettingsSectionId) =>
      nav.settingsSectionViewed(section)
    ),
    importedGame: useEventCallback((imported: ImportedGame) =>
      unlessOnlineGame(() => board.loadImportedGame(imported))
    ),
    beforePlayStart: useEventCallback(board.beforeEngineGame),
    play: useEventCallback(() => nav.openFreshPlayPage()),
    freeBoard: useEventCallback(() => unlessOnlineGame(board.startFreeBoard)),
    liveAnalysis: useEventCallback(() => unlessOnlineGame(board.startLiveAnalysis)),
    stopLiveAnalysis: useEventCallback(board.stopLiveAnalysis),
    analyzePosition: useEventCallback(board.analyzeCurrentPosition),
    openReviewPicker: useEventCallback(() => unlessOnlineGame(() => setGameReviewPickerOpen(true))),
    closeReviewPicker: useEventCallback(() => setGameReviewPickerOpen(false)),
    openImportDialog: useEventCallback(() => setImportOpen(true)),
    closeImportDialog: useEventCallback(() => setImportOpen(false)),
    reviewGame: useEventCallback((id: string) =>
      unlessOnlineGame(() => void board.openSelectedGameReview(id))
    ),
    // After a Lichess game: Play, in the Lichess mode it was played in (else Quick pairing).
    playLichess: useEventCallback(() => {
      const lichess = useLichessStore.getState();
      const mode = lichess.playOpponent;
      lichess.setPlayOpponent(mode && isLichessMode(mode) ? mode : "pool");
      nav.openFreshPlayPage();
    }),
    puzzles: useEventCallback(() => unlessOnlineGame(() => nav.openPuzzlesPage())),
    databases: useEventCallback(() => nav.openDatabasesPage()),
    // Databases → "Train with this dataset": Puzzles with that dataset chosen (other filters kept).
    trainWithDatabase: useEventCallback((databaseId: string) =>
      // A Lichess game on the board keeps it (like the Puzzles item).
      unlessOnlineGame(() => {
        usePuzzleDraftStore.getState().update({ databaseId });
        nav.openPuzzlesPage();
      })
    ),
    importPgn: useEventCallback(() => unlessOnlineGame(() => void board.importPgnFile())),
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
    playEngineFromPuzzle: useEventCallback(puzzles.playEngineFromCurrentPuzzlePosition),
    // The puzzle card's "Edit set": the Puzzles page with the running set's filters, to start a new set.
    editPuzzleSet: useEventCallback(() => {
      const activePuzzleConfig = nav.puzzleSession.config;
      if (activePuzzleConfig)
        usePuzzleDraftStore.getState().update(draftFromSessionConfig(activePuzzleConfig));
      nav.openPuzzlesPage();
    }),
    reviewCurrentGame: useEventCallback(() => void board.openSelectedGameReview("current")),
    reviewEngineGame: useEventCallback(() => void board.reviewFinishedEngineGame()),
    repertoireHub: useEventCallback(() => repertoire.openRepertoireHub()),
    openRepertoireStudy,
    // "Refresh this decision" (a game's opening comparison): a targeted queue that starts at once.
    // Back returns to the review left (its tab and move are committed first).
    refreshRepertoireDecision: useEventCallback((repertoireId: string, positionKey: string) =>
      unlessRepertoireBlocked(
        "refresh-decision",
        () =>
          void repertoire.openRepertoirePractice(repertoireId, {
            preset: { mode: "review-due", positionKeys: [positionKey], autoStart: true }
          })
      )
    ),
    repertoireStageApplied: useEventCallback(() =>
      setRepertoireExtras((extras) => ({ ...extras, stage: null }))
    ),
    openRepertoirePractice: useEventCallback((repertoireId: string) =>
      unlessRepertoireBlocked(
        "open-practice",
        () => void repertoire.openRepertoirePractice(repertoireId)
      )
    ),
    // "Review now" / "Review due": the setup in Review due over every chapter, whatever the last
    // session's draft was (a Learn new draft would otherwise hide the due decisions).
    reviewRepertoire: useEventCallback((repertoireId: string) =>
      unlessRepertoireBlocked(
        "open-practice",
        () =>
          void repertoire.openRepertoirePractice(repertoireId, {
            preset: { mode: "review-due", chapterIds: [] }
          })
      )
    ),
    resumeRepertoirePractice: useEventCallback(
      ({ repertoireId, sessionId }: { repertoireId: string; sessionId: string }) =>
        unlessRepertoireBlocked(
          "resume-practice",
          () => void repertoire.openRepertoirePractice(repertoireId, { sessionId })
        )
    ),
    practiceRepertoireChapters: useEventCallback((repertoireId: string, chapterIds: string[]) =>
      unlessRepertoireBlocked(
        "open-practice",
        () => void repertoire.openRepertoirePractice(repertoireId, { preset: { chapterIds } })
      )
    ),
    // "Rehearse this chapter / from here" (Study) and "Rehearse again" (a summary): the rehearsal
    // starts at once, as a new step (Back returns to where it was asked for).
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
    openGameAtNode: useEventCallback((gameId: string, nodeId: string | null) =>
      unlessOnlineGame(() => void board.openSavedGameById(gameId, nodeId ?? "root"))
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
    repertoirePracticeSetup: useEventCallback(() =>
      unlessRepertoireBlocked("open-practice", repertoire.practiceSetup)
    ),
    playFromStudy: useEventCallback(() =>
      unlessRepertoireBlocked(
        "play-from-here",
        () => void repertoire.playFromStudy(() => retryPlayFromStudy.current())
      )
    ),
    returnToRepertoire: useEventCallback(() =>
      unlessRepertoireBlocked("return-to-repertoire", repertoire.returnToRepertoire)
    ),
    reviewHandoffOpening: useEventCallback(() =>
      unlessRepertoireBlocked("review-opening", () => void repertoire.reviewHandoffOpening())
    )
  };
  useLayoutEffect(() => {
    retryPlayFromStudy.current = on.playFromStudy;
  }, [on.playFromStudy]);
  return on;
}

export type AppCommands = ReturnType<typeof useAppCommands>;
