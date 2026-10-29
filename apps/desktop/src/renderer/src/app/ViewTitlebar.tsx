import { lazy, Suspense } from "react";
import { hasDesktopApi } from "@/lib/environment";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import {
  RepertoirePracticeTitlebar,
  RepertoireStudyTitlebar
} from "../features/repertoire/RepertoireTitlebar";
import { selectLiveGameInProgress, useLichessStore } from "../stores/lichess-store";
import type { BroadcastScreen } from "../features/broadcasts/navigation";
import { TournamentTitle } from "../features/broadcasts/TournamentTitle";
import type { AppView, RepertoireScreen } from "./AppPages";
import { GameTitlebar, LiveGameButton, PageTitle, ReviewTitlebar } from "./AppTitlebar";
import type { AppCommands } from "./useAppCommands";

// Repertoire's tabs load with its page (lazy too), out of the first screen's code.
const RepertoireHubTitlebar = lazy(() =>
  import("../features/repertoire/RepertoireHubTitlebar").then((module) => ({
    default: module.RepertoireHubTitlebar
  }))
);

const pageTitles: Partial<Record<AppView, string>> = {
  settings: "Settings",
  play: "Play",
  puzzles: "Puzzles",
  databases: "Databases",
  broadcasts: "Broadcasts"
};

/**
 * The titlebar's content for the current view: the review's or the board's commands, the
 * repertoire screen's, or a page's title.
 */
export function ViewTitlebar({
  view,
  repertoire,
  broadcastScreen,
  reviewLoading,
  hasMoves,
  engines,
  showAnalysisError,
  puzzleSetContinues,
  nextPuzzlePending,
  on
}: {
  view: AppView;
  repertoire: RepertoireScreen | null;
  broadcastScreen: BroadcastScreen | null;
  /** The review route's game is still loading (Analyze waits). */
  reviewLoading: boolean;
  /** The game has a main line to review. */
  hasMoves: boolean;
  engines: readonly EngineConfig[] | undefined;
  showAnalysisError: boolean;
  /** A game played on from a puzzle: Next puzzle (after it) resumes the set. */
  puzzleSetContinues: boolean;
  nextPuzzlePending: boolean;
  on: Pick<
    AppCommands,
    | "startReview"
    | "stopReview"
    | "playFromStudy"
    | "analyzePosition"
    | "reviewCurrentGame"
    | "playLichess"
    | "reviewEngineGame"
    | "nextPuzzle"
    | "reviewHandoffOpening"
    | "returnToRepertoire"
    | "backToInsights"
    | "showGame"
    | "broadcasts"
    | "openSettings"
  >;
}) {
  // A Lichess game on the board: nothing may replace it and the engine stays off until it ends.
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  if (view === "game-review") {
    return (
      <ReviewTitlebar
        gameLoading={reviewLoading}
        hasMoves={hasMoves}
        onAnalyze={on.startReview}
        onStop={on.stopReview}
        onBackToInsights={on.backToInsights}
      />
    );
  }
  if (view === "repertoire-study" && repertoire) {
    return (
      <RepertoireStudyTitlebar
        repertoireId={repertoire.repertoireId}
        onPlayFromHere={hasDesktopApi() ? on.playFromStudy : undefined}
      />
    );
  }
  if (view === "repertoire-hub") {
    // The live game's button goes among the tab's actions, before the cog (always last).
    return (
      <Suspense fallback={<PageTitle>Repertoire</PageTitle>}>
        <RepertoireHubTitlebar
          onOpenSettings={on.openSettings}
          leading={onlineGameLive ? <LiveGameButton onClick={on.showGame} /> : null}
        />
      </Suspense>
    );
  }
  if (view === "repertoire-practice" && repertoire) {
    return <RepertoirePracticeTitlebar repertoireId={repertoire.repertoireId} />;
  }
  if (view === "broadcast-tournament" && broadcastScreen) {
    return (
      <>
        <TournamentTitle tourId={broadcastScreen.tourId} onBroadcasts={on.broadcasts} />
        {onlineGameLive ? <LiveGameButton onClick={on.showGame} /> : null}
      </>
    );
  }
  if (view === "game") {
    return (
      <GameTitlebar
        engines={engines}
        showAnalysisError={showAnalysisError}
        onAnalyze={on.analyzePosition}
        onReviewGame={on.reviewCurrentGame}
        onPlayAgain={on.playLichess}
        onReviewEngineGame={on.reviewEngineGame}
        onNextPuzzle={puzzleSetContinues ? on.nextPuzzle : null}
        nextPuzzlePending={nextPuzzlePending}
        onReviewOpening={on.reviewHandoffOpening}
        onReturnToRepertoire={on.returnToRepertoire}
      />
    );
  }
  return (
    <>
      <PageTitle>{pageTitles[view]}</PageTitle>
      {onlineGameLive ? <LiveGameButton onClick={on.showGame} /> : null}
    </>
  );
}
