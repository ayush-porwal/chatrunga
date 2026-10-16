import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { BroadcastRoundDetail } from "@chaturanga/shared/types/broadcast";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { Color } from "@chaturanga/shared/types/chess";
import { rehearsePreset, type PracticePreset } from "../features/repertoire/practice-setup";
import type { StudyOpenTarget, StudyStage } from "../features/repertoire/repertoire-chapters";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { BroadcastScreen, TournamentTarget } from "../features/broadcasts/navigation";
import type { ReviewTab } from "../features/game-review/review-utils";
import type { OpeningSide } from "../features/game-review/opening-comparison";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { OpenSettingsContext } from "../features/settings/settings-link";
import { GameWorkspace } from "./GameWorkspace";
import type { SideTab } from "./side-tabs";
import { PlayPage } from "../features/play/PlayPage";

// Pages and panels load when first opened, so starting the app (Play, the board) doesn't parse the
// review charts, settings, puzzles, databases or the welcome.
const DatabasePage = lazy(() =>
  import("../features/database/DatabasePage").then((module) => ({ default: module.DatabasePage }))
);
const GameReviewPage = lazy(() =>
  import("../features/game-review/GameReviewPage").then((module) => ({
    default: module.GameReviewPage
  }))
);
export const AddToRepertoireDialog = lazy(() =>
  import("../features/repertoire/AddToRepertoireDialog").then((module) => ({
    default: module.AddToRepertoireDialog
  }))
);
export const GameReviewPicker = lazy(() =>
  import("../features/game-review/GameReviewPicker").then((module) => ({
    default: module.GameReviewPicker
  }))
);
const PuzzlePage = lazy(() =>
  import("../features/puzzles/PuzzlePage").then((module) => ({ default: module.PuzzlePage }))
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const BroadcastsPage = lazy(() =>
  import("../features/broadcasts/BroadcastsPage").then((module) => ({
    default: module.BroadcastsPage
  }))
);
const TournamentPage = lazy(() =>
  import("../features/broadcasts/TournamentPage").then((module) => ({
    default: module.TournamentPage
  }))
);
const RepertoireHubPage = lazy(() =>
  import("../features/repertoire/RepertoireHubPage").then((module) => ({
    default: module.RepertoireHubPage
  }))
);
const RepertoireStudyPage = lazy(() =>
  import("../features/repertoire/RepertoireStudyPage").then((module) => ({
    default: module.RepertoireStudyPage
  }))
);
const RepertoirePracticePage = lazy(() =>
  import("../features/repertoire/RepertoirePracticePage").then((module) => ({
    default: module.RepertoirePracticePage
  }))
);
export const OnboardingFlow = lazy(() =>
  import("../features/onboarding/OnboardingFlow").then((module) => ({
    default: module.OnboardingFlow
  }))
);

/** How a navigation enters Back / Forward (see showView). */
export type AppView =
  | "game"
  | "settings"
  | "play"
  | "puzzles"
  | "databases"
  | "broadcasts"
  | "broadcast-tournament"
  | "game-review"
  | "repertoire-hub"
  | "repertoire-study"
  | "repertoire-practice";

/** The repertoire screen's route (ids from the URL) and the state App keeps for it. */
export type RepertoireScreen =
  | {
      view: "repertoire-study";
      repertoireId: string;
      chapterId: string;
      /** The node to select on open / restore (null: the draft's own, or the root). */
      nodeId: string | null;
      orientation: Color | null;
      tab: StudyTab;
      /** A move to stage once the chapter loads (applied once; see repertoireStageApplied). */
      stage: StudyStage | null;
    }
  | {
      view: "repertoire-practice";
      repertoireId: string;
      sessionId: string | null;
      preset: PracticePreset | null;
    };

/** What the pages can ask the app to do (App's command handlers). */
export type PageCommands = {
  liveAnalysis: () => void;
  importPgn: () => void;
  play: () => void;
  openGame: (id: string) => void;
  puzzles: () => void;
  openReviewPicker: () => void;
  reviewGame: (id: string) => void;
  engineSettings: () => void;
  settingsSectionViewed: (section: SettingsSectionId) => void;
  beforePlayStart: () => void;
  showGame: () => void;
  freeBoard: () => void;
  databases: () => void;
  broadcasts: () => void;
  /** A tournament from the hub or its search (a board picked by the search is outlined). */
  openBroadcastTournament: (target: TournamentTarget) => void;
  /** The tournament screen's round or tab changed. */
  broadcastScreenChange: (screen: BroadcastScreen) => void;
  /** A board of a round onto the analysis board, following its game live. */
  openBroadcastGame: (detail: BroadcastRoundDetail, gameId: string) => void;
  startPuzzle: (config: PuzzleSessionConfig, puzzle: PuzzleSample) => void;
  trainWithDatabase: (databaseId: string) => void;
  startReview: () => void;
  commentarySettings: () => void;
  /** App Settings at a section (links from a page or dialog: AI settings, ratings). */
  openSettings: (section: SettingsSectionId) => void;
  openGameFromLibrary: (id: string) => void;
  analyzePosition: () => void;
  stopLiveAnalysis: () => void;
  /** The board's game (with its analysis) as a .pgn file. */
  exportPgn: () => void;
  repertoireHub: () => void;
  openRepertoireStudy: (target: StudyOpenTarget) => void;
  refreshRepertoireDecision: (repertoireId: string, positionKey: string) => void;
  repertoireStageApplied: () => void;
  openRepertoirePractice: (repertoireId: string) => void;
  reviewRepertoire: (repertoireId: string) => void;
  /** "Resume practice": the unfinished session's route (it resumes there). */
  resumeRepertoirePractice: (target: { repertoireId: string; sessionId: string }) => void;
  practiceRepertoireChapters: (repertoireId: string, chapterIds: string[]) => void;
  /** A practice preset that starts on its own (line rehearsal: "Rehearse this chapter / again"). */
  rehearseRepertoire: (repertoireId: string, preset: PracticePreset) => void;
  repertoireMissing: (message: string) => void;
  repertoireTabChange: (tab: StudyTab) => void;
  repertoirePositionChanged: () => void;
  openGameAtNode: (gameId: string, nodeId: string | null) => void;
  repertoirePracticeStarted: (sessionId: string) => void;
  repertoirePracticeSetup: () => void;
  /** Study → Play from here: Play's engine setup starting at the selected node. */
  playFromStudy: () => void;
  /** Play's In progress card on a saved engine game: open it and play on against its engine. */
  rejoinSavedGame: (gameId: string) => void;
  /** Play's Puzzle of the day: Puzzles, starting with it (then the usual set). */
  solvePuzzleOfTheDay: (puzzle: PuzzleSample) => void;
};

/**
 * The page for the current view. App owns navigation and the board's activity; the pages only
 * render and call back (`on`). Pages other than Play and the board load on first use.
 */
export function AppPages({
  view,
  desktopApiAvailable,
  settingsSection,
  settings,
  settingsReady,
  reviewTab,
  onReviewTabChange,
  openingSide,
  onOpeningSideChange,
  reviewLoading,
  sideTab,
  onSideTabChange,
  canStartAnalysis,
  puzzlePanel,
  repertoire,
  broadcastScreen,
  on
}: {
  view: AppView;
  desktopApiAvailable: boolean;
  settingsSection: SettingsSectionId | null;
  settings: AppSettings;
  settingsReady: boolean;
  reviewTab: ReviewTab;
  onReviewTabChange: (tab: ReviewTab) => void;
  /** The Opening tab's picked side (kept here so a history entry can carry it). */
  openingSide: OpeningSide | null;
  onOpeningSideChange: (side: OpeningSide) => void;
  /** The review route's game is still loading (Analyze waits). */
  reviewLoading: boolean;
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  canStartAnalysis: boolean;
  puzzlePanel: ReactNode;
  repertoire: RepertoireScreen | null;
  broadcastScreen: BroadcastScreen | null;
  on: PageCommands;
}) {
  return (
    <OpenSettingsContext.Provider value={on.openSettings}>
      <Suspense fallback={<PageLoading />}>
        {view === "play" ? (
          <PlayPage
            desktopApiAvailable={desktopApiAvailable}
            onOpenEngineSettings={on.engineSettings}
            onBeforeEngineGame={on.beforePlayStart}
            onEngineGameStarted={on.showGame}
            onFreeBoard={on.freeBoard}
            onOpenLichessGame={on.showGame}
            onRejoinSavedGame={on.rejoinSavedGame}
            onRepertoireReview={on.reviewRepertoire}
            onRepertoireResume={on.resumeRepertoirePractice}
            onRepertoireStudy={on.openRepertoireStudy}
            onSolvePuzzleOfTheDay={on.solvePuzzleOfTheDay}
            onOpenDatabases={on.databases}
            onOpenBroadcasts={on.broadcasts}
            onOpenBroadcastTournament={on.openBroadcastTournament}
            onOpenGame={on.openGame}
            onReviewGame={on.reviewGame}
            onAnalyze={on.liveAnalysis}
            onPuzzles={on.puzzles}
            onImportPgn={on.importPgn}
          />
        ) : view === "repertoire-hub" ? (
          <RepertoireHubPage
            onStudy={on.openRepertoireStudy}
            onPractice={on.openRepertoirePractice}
            onResume={on.resumeRepertoirePractice}
            onReview={on.reviewRepertoire}
          />
        ) : view === "repertoire-study" || view === "repertoire-practice" ? (
          <RepertoireScreenPage
            view={view}
            repertoire={repertoire}
            desktopApiAvailable={desktopApiAvailable}
            on={on}
          />
        ) : view === "settings" ? (
          <SettingsPage
            initialSection={settingsSection}
            onSectionChange={on.settingsSectionViewed}
          />
        ) : view === "puzzles" ? (
          <PuzzlePage onDatabases={on.databases} onStart={on.startPuzzle} />
        ) : view === "databases" ? (
          <DatabasePage onTrain={on.trainWithDatabase} />
        ) : view === "broadcasts" ? (
          <BroadcastsPage onOpenTournament={on.openBroadcastTournament} />
        ) : view === "broadcast-tournament" ? (
          broadcastScreen ? (
            <TournamentPage
              screen={broadcastScreen}
              onScreenChange={on.broadcastScreenChange}
              onOpenGame={on.openBroadcastGame}
            />
          ) : (
            <BroadcastsPage onOpenTournament={on.openBroadcastTournament} />
          )
        ) : view === "game-review" ? (
          <GameReviewPage
            activeTab={reviewTab}
            onTabChange={onReviewTabChange}
            settings={settings}
            settingsReady={settingsReady}
            onAnalyze={reviewLoading ? undefined : on.startReview}
            onImportPgn={on.importPgn}
            onPlay={on.play}
            onExportPgn={on.exportPgn}
            onOpenCommentarySettings={on.commentarySettings}
            onOpenRepertoireStudy={on.openRepertoireStudy}
            onRefreshRepertoireDecision={on.refreshRepertoireDecision}
            onRepertoireHub={on.repertoireHub}
            openingSide={openingSide}
            onOpeningSideChange={onOpeningSideChange}
            onOpenPuzzles={on.puzzles}
          />
        ) : (
          <GameWorkspace
            onOpenGame={on.openGameFromLibrary}
            sideTab={sideTab}
            onSideTabChange={onSideTabChange}
            onStartAnalysis={canStartAnalysis ? on.analyzePosition : undefined}
            onStopAnalysis={on.stopLiveAnalysis}
            onExportPgn={on.exportPgn}
            puzzlePanel={puzzlePanel}
            onOpenSettings={on.engineSettings}
            onOpenBroadcastGame={on.openBroadcastGame}
          />
        )}
      </Suspense>
    </OpenSettingsContext.Provider>
  );
}

/** The study or practice page of the repertoire screen the route names. */
function RepertoireScreenPage({
  view,
  repertoire,
  desktopApiAvailable,
  on
}: {
  view: "repertoire-study" | "repertoire-practice";
  repertoire: RepertoireScreen | null;
  desktopApiAvailable: boolean;
  on: PageCommands;
}) {
  // Its route is still catching up (the router applies a URL change in a transition, after the
  // view): not the game's board meanwhile.
  if (repertoire?.view !== view) return <PageLoading />;
  if (repertoire.view === "repertoire-study") {
    return (
      <RepertoireStudyPage
        repertoireId={repertoire.repertoireId}
        chapterId={repertoire.chapterId}
        initialNodeId={repertoire.nodeId}
        initialOrientation={repertoire.orientation}
        tab={repertoire.tab}
        stage={repertoire.stage}
        onStageApplied={on.repertoireStageApplied}
        onTabChange={on.repertoireTabChange}
        onOpenChapter={(chapterId, nodeId = null) =>
          on.openRepertoireStudy({ repertoireId: repertoire.repertoireId, chapterId, nodeId })
        }
        onPractice={(chapterIds) =>
          on.practiceRepertoireChapters(repertoire.repertoireId, chapterIds)
        }
        onRehearse={(target) =>
          on.rehearseRepertoire(repertoire.repertoireId, rehearsePreset(target))
        }
        onMissing={on.repertoireMissing}
        onHub={on.repertoireHub}
        onPositionChanged={on.repertoirePositionChanged}
        onOpenGame={on.openGameAtNode}
        onOpenEngineSettings={on.engineSettings}
        onPlayFromHere={desktopApiAvailable ? on.playFromStudy : undefined}
      />
    );
  }
  return (
    <RepertoirePracticePage
      repertoireId={repertoire.repertoireId}
      sessionId={repertoire.sessionId}
      preset={repertoire.preset}
      onSessionStarted={on.repertoirePracticeStarted}
      onSetup={on.repertoirePracticeSetup}
      onStudy={({ chapterId, nodeId }) =>
        on.openRepertoireStudy({ repertoireId: repertoire.repertoireId, chapterId, nodeId })
      }
      onRehearse={(preset) => on.rehearseRepertoire(repertoire.repertoireId, preset)}
    />
  );
}

/** While a page's code loads (the first time it opens): a quiet, centred spinner. */
function PageLoading() {
  return (
    <div className="grid place-items-center" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin text-fg-subtle" />
    </div>
  );
}
