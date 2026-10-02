import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { Color } from "@chaturanga/shared/types/chess";
import type { PracticePreset } from "../features/repertoire/practice-setup";
import type { StudyOpenTarget, StudyStage } from "../features/repertoire/repertoire-chapters";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { ReviewTab } from "../features/game-review/review-utils";
import type { OpeningSide } from "../features/game-review/opening-comparison";
import type { PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import type { SettingsSectionId } from "../features/settings/SettingsPage";
import { GameWorkspace, type SideTab } from "./GameWorkspace";
import { HomePage } from "./HomePage";

// Pages and panels load when first opened, so starting the app (Home, the board) doesn't parse the
// review charts, settings, puzzles, databases or the welcome.
const PlayPage = lazy(() => import("../features/game/PlayPage").then((module) => ({ default: module.PlayPage })));
const DatabasePage = lazy(() =>
  import("../features/database/DatabasePage").then((module) => ({ default: module.DatabasePage }))
);
const GameReviewPage = lazy(() =>
  import("../features/game-review/GameReviewPage").then((module) => ({ default: module.GameReviewPage }))
);
export const AddToRepertoireDialog = lazy(() =>
  import("../features/repertoire/AddToRepertoireDialog").then((module) => ({
    default: module.AddToRepertoireDialog
  }))
);
export const GameReviewPicker = lazy(() =>
  import("../features/game-review/GameReviewPicker").then((module) => ({ default: module.GameReviewPicker }))
);
const PuzzlePage = lazy(() => import("../features/puzzles/PuzzlePage").then((module) => ({ default: module.PuzzlePage })));
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const RepertoireHubPage = lazy(() =>
  import("../features/repertoire/RepertoireHubPage").then((module) => ({ default: module.RepertoireHubPage }))
);
const RepertoireStudyPage = lazy(() =>
  import("../features/repertoire/RepertoireStudyPage").then((module) => ({ default: module.RepertoireStudyPage }))
);
const RepertoirePracticePage = lazy(() =>
  import("../features/repertoire/RepertoirePracticePage").then((module) => ({
    default: module.RepertoirePracticePage
  }))
);
export const OnboardingFlow = lazy(() =>
  import("../features/onboarding/OnboardingFlow").then((module) => ({ default: module.OnboardingFlow }))
);

/** How a navigation enters Back / Forward (see showView). */
export type AppView =
  | "home"
  | "game"
  | "settings"
  | "play"
  | "puzzles"
  | "databases"
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
  startPuzzle: (config: PuzzleSessionConfig, puzzle: PuzzleSample) => void;
  trainWithDatabase: (databaseId: string) => void;
  startReview: () => void;
  commentarySettings: () => void;
  openGameFromLibrary: (id: string) => void;
  analyzePosition: () => void;
  stopLiveAnalysis: () => void;
  repertoireHub: () => void;
  openRepertoireStudy: (target: StudyOpenTarget) => void;
  refreshRepertoireDecision: (repertoireId: string, positionKey: string) => void;
  repertoireStageApplied: () => void;
  openRepertoirePractice: (repertoireId: string) => void;
  reviewRepertoire: (repertoireId: string) => void;
  practiceRepertoireChapters: (repertoireId: string, chapterIds: string[]) => void;
  repertoireMissing: (message: string) => void;
  repertoireTabChange: (tab: StudyTab) => void;
  repertoirePositionChanged: () => void;
  openGameAtNode: (gameId: string, nodeId: string | null) => void;
  repertoirePracticeStarted: (sessionId: string) => void;
  repertoirePracticeSetup: () => void;
};

/**
 * The page for the current view. App owns navigation and the board's activity; the pages only
 * render and call back (`on`). Pages other than Home and the board load on first use.
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
  on: PageCommands;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      {view === "home" ? (
        <HomePage
          desktopApiAvailable={desktopApiAvailable}
          onAnalyze={on.liveAnalysis}
          onImportPgn={on.importPgn}
          onPlay={on.play}
          onOpenGame={on.openGame}
          onPuzzles={on.puzzles}
          onReview={on.openReviewPicker}
          onReviewGame={on.reviewGame}
          onOpenEngineSettings={on.engineSettings}
          onRepertoireHub={on.repertoireHub}
          onRepertoireReview={on.reviewRepertoire}
          onRepertoireStudy={on.openRepertoireStudy}
        />
      ) : view === "repertoire-hub" ? (
        <RepertoireHubPage
          onStudy={on.openRepertoireStudy}
          onPractice={on.openRepertoirePractice}
          onReview={on.reviewRepertoire}
        />
      ) : view === "repertoire-study" && repertoire?.view === "repertoire-study" ? (
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
          onPractice={(chapterIds) => on.practiceRepertoireChapters(repertoire.repertoireId, chapterIds)}
          onMissing={on.repertoireMissing}
          onPositionChanged={on.repertoirePositionChanged}
          onOpenGame={on.openGameAtNode}
        />
      ) : view === "repertoire-practice" && repertoire?.view === "repertoire-practice" ? (
        <RepertoirePracticePage
          repertoireId={repertoire.repertoireId}
          sessionId={repertoire.sessionId}
          preset={repertoire.preset}
          onSessionStarted={on.repertoirePracticeStarted}
          onSetup={on.repertoirePracticeSetup}
          onStudy={({ chapterId, nodeId }) =>
            on.openRepertoireStudy({ repertoireId: repertoire.repertoireId, chapterId, nodeId })
          }
        />
      ) : view === "settings" ? (
        <SettingsPage initialSection={settingsSection} onSectionChange={on.settingsSectionViewed} />
      ) : view === "play" ? (
        <PlayPage
          onOpenSettings={on.engineSettings}
          onBeforeStart={on.beforePlayStart}
          onStart={on.showGame}
          onOpenLichessGame={on.showGame}
          onFreeBoard={on.freeBoard}
        />
      ) : view === "puzzles" ? (
        <PuzzlePage onDatabases={on.databases} onStart={on.startPuzzle} />
      ) : view === "databases" ? (
        <DatabasePage onTrain={on.trainWithDatabase} />
      ) : view === "game-review" ? (
        <GameReviewPage
          activeTab={reviewTab}
          onTabChange={onReviewTabChange}
          settings={settings}
          settingsReady={settingsReady}
          onAnalyze={reviewLoading ? undefined : on.startReview}
          onImportPgn={on.importPgn}
          onPlay={on.play}
          onOpenCommentarySettings={on.commentarySettings}
          onOpenRepertoireStudy={on.openRepertoireStudy}
          onRefreshRepertoireDecision={on.refreshRepertoireDecision}
          onRepertoireHub={on.repertoireHub}
          openingSide={openingSide}
          onOpeningSideChange={onOpeningSideChange}
        />
      ) : (
        <GameWorkspace
          onOpenGame={on.openGameFromLibrary}
          sideTab={sideTab}
          onSideTabChange={onSideTabChange}
          onStartAnalysis={canStartAnalysis ? on.analyzePosition : undefined}
          onStopAnalysis={on.stopLiveAnalysis}
          puzzlePanel={puzzlePanel}
          onOpenSettings={on.engineSettings}
        />
      )}
    </Suspense>
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
