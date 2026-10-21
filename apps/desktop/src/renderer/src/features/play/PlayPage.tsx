import { memo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  boardCardKinds,
  isFirstRun,
  playGrid,
  type BoardCardKind,
  type PlayGrid
} from "./play-layout";
import { recentRows, useRecentGamesQuery } from "./recent-games";
import { useContentBox } from "./use-content-box";
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

/** The loading row's shape: the Play card and all three board cards (as many as fit). */
const SKELETON_CARDS = 3;

/**
 * Play, where the app opens: the Play card (you against the opponent from Play settings), the
 * board cards with something to pick up (the game in progress, the repertoire positions due, the
 * puzzle of the day), then Recent games and the side cards. Two columns shared by both rows (see
 * playGrid): the Play card over Recent games, the board cards over the side cards, so the edges
 * line up at every window size. Board cards that don't fit are left out; with none, the filler
 * card takes one card's place.
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
  const pageRef = useRef<HTMLDivElement | null>(null);
  const size = useContentBox(pageRef, { viewportHeight: true });

  const firstRun = isFirstRun({ engineCount: page.engineCount, hasAccount: page.hasAccount });
  const { card, repertoire, puzzleOfTheDay } = boardCardsFor(page, {
    firstRun,
    desktopApiAvailable
  });
  const excludeGameId = card?.excludeGameId ?? null;
  // An empty library: the table stretches to the bottom of the window.
  const fill = games.isSuccess && recentRows(games.data, excludeGameId).length === 0;

  const kinds = boardCardKinds({
    inProgress: Boolean(card),
    repertoire: Boolean(repertoire),
    puzzle: Boolean(puzzleOfTheDay)
  });
  const grid = size ? playGrid({ ...size, cards: loading ? SKELETON_CARDS : kinds.length }) : null;

  const boardCard = (kind: BoardCardKind) => (
    <BoardCardFor
      kind={kind}
      card={card}
      repertoire={repertoire}
      puzzleOfTheDay={puzzleOfTheDay}
      props={props}
    />
  );

  return (
    <div className={pageShell}>
      <div ref={pageRef} className="flex min-h-full flex-col p-6">
        <h1 className="sr-only">Play</h1>
        {grid ? (
          <div className={cn("grid gap-4", fill && "flex-1")} style={gridStyle(grid, fill)}>
            {loading ? (
              <TopRowSkeleton cards={grid.cards} cardWidth={grid.cardWidth} />
            ) : (
              <>
                <div className={cn("flex min-w-0 flex-col *:flex-1", reveal)}>
                  <PlayCard
                    wide={grid.wide}
                    firstRun={firstRun}
                    desktopApiAvailable={desktopApiAvailable}
                    onOpenEngineSettings={props.onOpenEngineSettings}
                    onBeforeEngineGame={props.onBeforeEngineGame}
                    onEngineGameStarted={props.onEngineGameStarted}
                    onFreeBoard={props.onFreeBoard}
                  />
                </div>
                <div className={cn("flex min-w-0 gap-4", reveal)}>
                  {grid.cards ? (
                    kinds.slice(0, grid.cards).map((kind) => (
                      <CardSlot key={kind} width={grid.cardWidth}>
                        {boardCard(kind)}
                      </CardSlot>
                    ))
                  ) : (
                    <CardSlot width={grid.cardWidth}>
                      <FillerCard
                        firstRun={firstRun}
                        puzzleDatabase={puzzle.installed}
                        onOpenDatabases={props.onOpenDatabases}
                      />
                    </CardSlot>
                  )}
                </div>
              </>
            )}
            {/* Its columns' widths wait for the board cards' count: no jump once it is known. */}
            {loading ? null : (
              <>
                <div className={cn("flex min-w-0 flex-col", reveal)}>
                  <RecentGamesTable
                    excludeGameId={excludeGameId}
                    fill={fill}
                    onOpenGame={props.onOpenGame}
                    onReviewGame={props.onReviewGame}
                  />
                </div>
                <SideCards props={props} firstRun={firstRun} reveal={reveal} />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * The grid's tracks: the Play column and the cards' (one column when stacked), the top row the
 * row height. The Play card's content may need a little more in a setup it doesn't usually have
 * (a long Lichess notice): the row grows rather than run into Recent games.
 */
function gridStyle(grid: PlayGrid, fill: boolean): CSSProperties {
  const top = `minmax(${grid.rowHeight}px, auto)`;
  const bottom = fill ? "1fr" : "auto";
  return grid.stacked
    ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: `${top} ${top} auto ${bottom}` }
    : {
        gridTemplateColumns: `minmax(0, 1fr) ${grid.sideWidth}px`,
        gridTemplateRows: `${top} ${bottom}`
      };
}

/** A board card's place in the top row: one card's width, the row's height. */
function CardSlot({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col *:flex-1" style={{ width }}>
      {children}
    </div>
  );
}

/** The top row while the page's first data arrives: the Play card and as many board cards as fit. */
function TopRowSkeleton({ cards, cardWidth }: { cards: number; cardWidth: number }) {
  return (
    <>
      <div className="flex min-w-0 flex-col *:flex-1" aria-busy="true" aria-label="Loading">
        <PlayCardSkeleton />
      </div>
      <div className="flex min-w-0 gap-4" aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <CardSlot key={index} width={cardWidth}>
            <BoardCardSkeleton />
          </CardSlot>
        ))}
      </div>
    </>
  );
}

/** One board card, by its kind (null when it has nothing to show). */
function BoardCardFor({
  kind,
  card,
  repertoire,
  puzzleOfTheDay,
  props
}: ReturnType<typeof boardCardsFor> & { kind: BoardCardKind; props: PlayPageProps }) {
  switch (kind) {
    case "in-progress":
      return card ? <InProgressBoardCard card={card} onRejoin={() => rejoin(card, props)} /> : null;
    case "repertoire":
      return repertoire ? (
        <RepertoireBoardCard
          content={repertoire}
          onReview={props.onRepertoireReview}
          onResume={props.onRepertoireResume}
          onStudy={props.onRepertoireStudy}
        />
      ) : null;
    case "puzzle":
      return puzzleOfTheDay ? (
        <PuzzleOfTheDayCard puzzle={puzzleOfTheDay} onSolve={props.onSolvePuzzleOfTheDay} />
      ) : null;
  }
}

/** The side column under the board cards: Start something new, challenges, live broadcasts. */
function SideCards({
  props,
  firstRun,
  reveal
}: {
  props: PlayPageProps;
  firstRun: boolean;
  reveal: string | undefined;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col gap-4", reveal)}>
      <StartSomethingNewCard
        desktopApiAvailable={props.desktopApiAvailable}
        onAnalyze={props.onAnalyze}
        onPuzzles={props.onPuzzles}
        onImportPgn={props.onImportPgn}
      />
      {firstRun ? null : <ChallengesCard />}
      {props.desktopApiAvailable ? (
        <LiveBroadcastsCard
          className="flex-1"
          onOpenTournament={props.onOpenBroadcastTournament}
          onOpenBroadcasts={props.onOpenBroadcasts}
        />
      ) : null}
    </div>
  );
}

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
