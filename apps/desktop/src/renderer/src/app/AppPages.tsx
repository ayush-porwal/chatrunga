import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { ReviewTab } from "../features/game-review/review-utils";
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
export const GameReviewPicker = lazy(() =>
  import("../features/game-review/GameReviewPicker").then((module) => ({ default: module.GameReviewPicker }))
);
const PuzzlePage = lazy(() => import("../features/puzzles/PuzzlePage").then((module) => ({ default: module.PuzzlePage })));
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
export const OnboardingFlow = lazy(() =>
  import("../features/onboarding/OnboardingFlow").then((module) => ({ default: module.OnboardingFlow }))
);

/** How a navigation enters Back / Forward (see showView). */
export type AppView = "home" | "game" | "settings" | "play" | "puzzles" | "databases" | "game-review";

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
  reviewLoading,
  sideTab,
  onSideTabChange,
  canStartAnalysis,
  puzzlePanel,
  on
}: {
  view: AppView;
  desktopApiAvailable: boolean;
  settingsSection: SettingsSectionId | null;
  settings: AppSettings;
  settingsReady: boolean;
  reviewTab: ReviewTab;
  onReviewTabChange: (tab: ReviewTab) => void;
  /** The review route's game is still loading (Analyze waits). */
  reviewLoading: boolean;
  sideTab: SideTab;
  onSideTabChange: (tab: SideTab) => void;
  canStartAnalysis: boolean;
  puzzlePanel: ReactNode;
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
