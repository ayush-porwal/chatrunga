import { memo, useState, type ReactNode } from "react";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { pageShell } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { useRepertoireDueSummaryQuery } from "../../queries/repertoire";
import { useLichessStore } from "../../stores/lichess-store";
import { LiveBroadcastsCard } from "../broadcasts/LiveBroadcastsCard";
import type { TournamentTarget } from "../broadcasts/navigation";
import type { ResumePracticeTarget, StudyTarget } from "../repertoire/repertoire-chapters";
import {
  BoardCardSkeleton,
  InProgressBoardCard,
  PlayCardSkeleton,
  PuzzleOfTheDayCard,
  RepertoireBoardCard,
  FillerCard
} from "./BoardCards";
import { PlayCard } from "./PlayCard";
import { ChallengesCard, StartSomethingNewCard } from "./PlaySideCards";
import { RecentGamesTable } from "./RecentGamesTable";
import { repertoireCardContent } from "./board-card-text";
import type { InProgressCard } from "./in-progress";
import {
  isFirstRun,
  narrowPlacements,
  topRowSlots,
  type NarrowPlacement,
  type TopSlot
} from "./play-layout";
import { recentRows, useRecentGamesQuery } from "./recent-games";
import { useInProgressCard, usePuzzleOfTheDay } from "./use-play-page-data";
import "./play.css";

export type PlayPageProps = {
  desktopApiAvailable: boolean;
  onOpenEngineSettings: () => void;
  onBeforeEngineGame: () => void;
  onEngineGameStarted: () => void;
  onFreeBoard: () => void;
  onOpenLichessGame: () => void;
  onRejoinSavedGame: (gameId: string) => void;
  onRepertoireReview: (repertoireId: string) => void;
  onRepertoireResume: (target: ResumePracticeTarget) => void;
  onRepertoireStudy: (target: StudyTarget) => void;
  onSolvePuzzleOfTheDay: (puzzle: PuzzleSample) => void;
  onOpenGame: (gameId: string) => void;
  onReviewGame: (gameId: string) => void;
  onAnalyze: () => void;
  onPuzzles: () => void;
  onImportPgn: () => void;
  /** Databases (the filler card's way to get a puzzle database). */
  onOpenDatabases: () => void;
  /** The Broadcasts page, and a tournament of it (the Live broadcasts card). */
  onOpenBroadcasts: () => void;
  onOpenBroadcastTournament: (target: TournamentTarget) => void;
};

/** The loading row's shape: the Play card and three board cards. */
const SKELETON_SLOTS = topRowSlots({ inProgress: true, repertoire: true, puzzle: true });
const SKELETON_PLACEMENTS = narrowPlacements(SKELETON_SLOTS);

/**
 * A top-row slot: its card (the grid item: the wrapper has no box) and where it goes, as CSS
 * variables play.css reads: its span, and its place in a narrow page (none: not shown there).
 */
function PlaySlot({
  slot,
  narrow,
  children
}: {
  slot: TopSlot;
  narrow: NarrowPlacement | null;
  children: ReactNode;
}) {
  return (
    <div
      className="play-slot contents"
      data-narrow-hidden={narrow ? undefined : ""}
      style={{
        "--span": "span" in slot ? slot.span : 1,
        "--narrow-column": narrow?.column ?? 1,
        "--narrow-span": narrow?.span ?? 1,
        "--narrow-row": narrow?.row ?? "1"
      }}
    >
      {children}
    </div>
  );
}

/** The top row: the Play card's column, then three (play.css: `.play-columns`). */
const columns = "play-columns grid items-stretch gap-4";
/** The row under it: the table under the first columns, the side cards under the last one. */
const bottomColumns = "play-columns-bottom grid items-stretch gap-4";

/**
 * Play, where the app opens: the Play card (you against the opponent from Play settings), the
 * board cards with something to pick up (the game in progress, the repertoire positions due, the
 * puzzle of the day), then Recent games and the side cards. The Play card takes two columns when
 * nothing is in progress; columns nothing else takes go to the filler card.
 */
export const PlayPage = memo(function PlayPage(props: PlayPageProps) {
  const { desktopApiAvailable } = props;
  const page = usePlayPageData();
  const { puzzle } = page;
  const games = useRecentGamesQuery();
  const loading = desktopApiAvailable && !page.settled;
  // Fade the cards in only when they replace the skeleton.
  const [mountedWhileLoading] = useState(loading);
  const reveal = mountedWhileLoading ? "animate-fade-in" : undefined;

  const firstRun = isFirstRun({ engineCount: page.engineCount, hasAccount: page.hasAccount });
  const { card, repertoire, puzzleOfTheDay } = boardCardsFor(page, {
    firstRun,
    desktopApiAvailable
  });
  const excludeGameId = card?.excludeGameId ?? null;
  // An empty library: the table stretches to the bottom of the window.
  const fill = games.isSuccess && recentRows(games.data, excludeGameId).length === 0;

  const slots = topRowSlots({
    inProgress: Boolean(card),
    repertoire: Boolean(repertoire),
    puzzle: Boolean(puzzleOfTheDay)
  });

  const placements = narrowPlacements(slots);
  const slotContent = (slot: TopSlot) => {
    switch (slot.kind) {
      case "play":
        return (
          <PlayCard
            key="play"
            span={slot.span}
            firstRun={firstRun}
            desktopApiAvailable={desktopApiAvailable}
            onOpenEngineSettings={props.onOpenEngineSettings}
            onBeforeEngineGame={props.onBeforeEngineGame}
            onEngineGameStarted={props.onEngineGameStarted}
            onFreeBoard={props.onFreeBoard}
          />
        );
      case "in-progress":
        return card ? (
          <InProgressBoardCard key="in-progress" card={card} onRejoin={() => rejoin(card, props)} />
        ) : null;
      case "repertoire":
        return repertoire ? (
          <RepertoireBoardCard
            key="repertoire"
            content={repertoire}
            onReview={props.onRepertoireReview}
            onResume={props.onRepertoireResume}
            onStudy={props.onRepertoireStudy}
          />
        ) : null;
      case "puzzle":
        return puzzleOfTheDay ? (
          <PuzzleOfTheDayCard
            key="puzzle"
            puzzle={puzzleOfTheDay}
            onSolve={props.onSolvePuzzleOfTheDay}
          />
        ) : null;
      case "filler":
        return (
          <FillerCard
            key="filler"
            firstRun={firstRun}
            puzzleDatabase={puzzle.installed}
            onOpenDatabases={props.onOpenDatabases}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={pageShell}>
      <div className="play-page flex min-h-full flex-col p-6">
        <h1 className="sr-only">Play</h1>
        {loading ? (
          <div className={columns} aria-busy="true" aria-label="Loading">
            {SKELETON_SLOTS.map((slot, index) => (
              <PlaySlot key={slot.kind} slot={slot} narrow={SKELETON_PLACEMENTS[index] ?? null}>
                {slot.kind === "play" ? <PlayCardSkeleton /> : <BoardCardSkeleton />}
              </PlaySlot>
            ))}
          </div>
        ) : (
          <div className={cn(columns, reveal)}>
            {slots.map((slot, index) => (
              <PlaySlot key={slot.kind} slot={slot} narrow={placements[index] ?? null}>
                {slotContent(slot)}
              </PlaySlot>
            ))}
          </div>
        )}
        <div className={cn(bottomColumns, "mt-4", fill && "flex-1")}>
          <div className="flex min-w-0 flex-col">
            <RecentGamesTable
              excludeGameId={excludeGameId}
              fill={fill}
              onOpenGame={props.onOpenGame}
              onReviewGame={props.onReviewGame}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <StartSomethingNewCard
              desktopApiAvailable={desktopApiAvailable}
              onAnalyze={props.onAnalyze}
              onPuzzles={props.onPuzzles}
              onImportPgn={props.onImportPgn}
            />
            {firstRun || loading ? null : <ChallengesCard />}
            {loading || !desktopApiAvailable ? null : (
              <LiveBroadcastsCard
                className="flex-1"
                onOpenTournament={props.onOpenBroadcastTournament}
                onOpenBroadcasts={props.onOpenBroadcasts}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * What the page shows and whether all of it has been read (`settled`): the final layout depends on
 * all of it, so until then skeletons hold its place.
 */
function usePlayPageData() {
  const engines = useEnginesQuery();
  const settings = useSettingsQuery();
  const lichessLoaded = useLichessStore((state) => state.loaded);
  const hasAccount = useLichessStore((state) => Boolean(state.status.account));
  const due = useRepertoireDueSummaryQuery();
  const inProgress = useInProgressCard();
  const puzzle = usePuzzleOfTheDay();
  return {
    engineCount: engines.data?.length ?? 0,
    hasAccount,
    due: due.data,
    inProgress: inProgress.card,
    puzzle,
    settled:
      !engines.isPending &&
      !settings.isPending &&
      (lichessLoaded || !window.chaturanga) &&
      !due.isPending &&
      inProgress.settled &&
      puzzle.settled
  };
}

/**
 * The board cards with something to pick up (none on a first run, and no repertoire without the
 * app).
 */
function boardCardsFor(
  page: ReturnType<typeof usePlayPageData>,
  { firstRun, desktopApiAvailable }: { firstRun: boolean; desktopApiAvailable: boolean }
) {
  if (firstRun) return { card: null, repertoire: null, puzzleOfTheDay: null };
  return {
    card: page.inProgress,
    repertoire: desktopApiAvailable ? repertoireCardContent(page.due) : null,
    puzzleOfTheDay: page.puzzle.puzzle
  };
}

/** Rejoin: back to the game on the board, resume your Lichess game, or open the saved one. */
function rejoin(card: InProgressCard, props: PlayPageProps) {
  switch (card.source) {
    case "live":
      props.onOpenLichessGame();
      break;
    case "lichess":
      if (card.targetId) useLichessStore.getState().resumeGame(card.targetId);
      break;
    case "board":
      // The engine match is still on the board: just show it.
      props.onEngineGameStarted();
      break;
    case "saved":
      if (card.targetId) props.onRejoinSavedGame(card.targetId);
      break;
  }
}
