import { memo, useCallback, useEffect, useId, useMemo, type ReactNode } from "react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { GameReview, MoveReview } from "@chaturanga/shared/types/engine";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { StudyOpenTarget } from "../repertoire/repertoire-chapters";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, selectDisplayedOpening, useReviewStore } from "../../stores/review-store";
import { useDisplayedReviewMoves } from "../../stores/review-validity";
import { mainlineReviewInput, reviewEngineName, type ReviewTab } from "./review-utils";
import { ReviewBoardStage, reviewPlayers } from "./ReviewBoardStage";
import { ReviewCommentaryPanel } from "./ReviewCommentaryPanel";
import { ReviewEnginePanel } from "./ReviewEnginePanel";
import { ReviewMoveRail } from "./ReviewMoveRail";
import { RepertoireHeadline, ReviewOpeningPanel } from "./ReviewOpeningPanel";
import { openReviewSettingsDialog, ReviewSettingsDialog } from "./ReviewSettingsDialog";
import { ReviewSummary } from "./ReviewSummary";
import { ReviewSummaryTab } from "./ReviewSummaryTab";
import { CardCommentaryContext, type CardCommentaryOptions } from "./MomentCommentary";
import { chooseReviewSide, reviewSideColor, useReviewSide } from "./review-side";
import { moverOf } from "./review-summary";
import { ReviewCharts } from "./ReviewCharts";
import { useAnalysisFollow } from "./useAnalysisFollow";
import { useReviewPanelAnchor } from "./useReviewPanelAnchor";
import { useReviewStepper } from "./useReviewStepper";
import { ErrorBoundary } from "@/components/error-boundary";
import { BoardWorkspace } from "../board/BoardWorkspace";
import { useMainlineMoveCount, WorkspaceTabBar, type WorkspaceTab } from "../board/WorkspaceTabBar";
import { useGameReviewCommentary } from "./useGameReviewCommentary";
import { reviewRatingLabel, useReviewRating } from "./use-review-rating";
import { useStoreHintsOnLeave } from "../onboarding/Coachmark";
import { useOpenRouterConfigQuery, useUpdateSettingMutation } from "../../queries/api";
import { openingSideFor, type OpeningSide } from "./opening-comparison";
import { keyMoments } from "@chaturanga/shared/chess/key-moments";
import { Settings, Sparkles, Swords, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { useReviewUsage } from "../../app/useUsageTelemetry";
import { DESTINATION_ICONS } from "../../app/destination-icons";
import { ReviewNavigationRow } from "./ReviewNavigationRow";
import { ReviewNotices, useReviewNotices } from "./ReviewNotices";

type GameReviewPageProps = {
  activeTab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  settings: AppSettings;
  /** Saved settings have loaded (until then `settings` holds defaults; no commentary is requested). */
  settingsReady?: boolean;
  /** Starts the engine review (same action as the titlebar Analyze button); offered by the empty states. */
  onAnalyze?: () => void;
  /** Offered when the game has no moves to review. */
  onImportPgn: () => void;
  onPlay: () => void;
  /** The tab bar's Export PGN: the game with its analysis (as on Analyze). */
  onExportPgn: () => void;
  /** Opens Settings → AI (offered when no OpenRouter key is saved). */
  onOpenCommentarySettings?: () => void;
  /** Opening tab: study a repertoire chapter (Back returns to this review at the same move). */
  onOpenRepertoireStudy?: (target: StudyOpenTarget) => void;
  /** Opening tab: "Refresh this decision" (a targeted practice queue). */
  onRefreshRepertoireDecision?: (repertoireId: string, positionKey: string) => void;
  /** Opening tab: the repertoire hub (create a repertoire or chapter). */
  onRepertoireHub?: () => void;
  /** Opening tab: the side picked for a game (App keeps it so Back restores it). */
  openingSide?: OpeningSide | null;
  onOpeningSideChange?: (side: OpeningSide) => void;
  /** Summary: shows the Puzzles page (its filters set to the opening or a theme first). */
  onOpenPuzzles?: () => void;
};

export const GameReviewPage = memo(function GameReviewPage(props: GameReviewPageProps) {
  return (
    <ErrorBoundary title="Game review hit an error" scope="game-review">
      <GameReviewPageInner {...props} />
    </ErrorBoundary>
  );
});

function GameReviewPageInner({
  activeTab,
  onTabChange,
  settings,
  settingsReady = true,
  onAnalyze,
  onImportPgn,
  onPlay,
  onExportPgn,
  onOpenCommentarySettings,
  onOpenRepertoireStudy,
  onRefreshRepertoireDecision,
  onRepertoireHub,
  openingSide,
  onOpeningSideChange,
  onOpenPuzzles
}: GameReviewPageProps) {
  // Narrow selectors: this page must not re-render for unrelated game-store changes.
  const gameId = useGameStore((state) => state.gameId);
  useStoreHintsOnLeave(gameId);
  useReviewUsage();
  const moveTree = useGameStore((state) => state.moveTree);
  const selectedNodeId = useGameStore((state) => state.currentNodeId);
  const orientation = useGameStore((state) => state.orientation);
  const headers = useGameStore((state) => state.headers);
  const goToNode = useGameStore((state) => state.goToNode);
  const shown = useShownReview();
  const { review, moves, running: isRunning, hasMoves } = shown;
  const reviewInput = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
  // While a review runs, the board follows its analysis until the user navigates themselves.
  const followLine = useMemo(
    () => ["root", ...reviewInput.map((move) => move.nodeId)],
    [reviewInput]
  );
  const follow = useAnalysisFollow(followLine, moves);
  // A move the user picks (the tree, a card, the charts, Start review) pauses following, even the
  // move already shown.
  const { pause: pauseFollow } = follow;
  const selectNode = useCallback(
    (nodeId: string) => {
      pauseFollow();
      goToNode(nodeId);
    },
    [goToNode, pauseFollow]
  );
  // The Opening tab's side, picked for this game (kept across tab switches and Back, not across games).
  const board = useGameStore((state) => state.board);
  const openingColor = openingSideFor(openingSide, board);
  const changeOpeningColor = useCallback(
    (color: RepertoireColor) => onOpeningSideChange?.({ board, color }),
    [board, onOpeningSideChange]
  );
  const rememberedRepertoires = useMemo(
    () => ({
      white: settings.repertoireCompareWhite ?? null,
      black: settings.repertoireCompareBlack ?? null
    }),
    [settings.repertoireCompareWhite, settings.repertoireCompareBlack]
  );
  const reviewByNodeId = useMemo(() => reviewsByNode(moves), [moves]);
  const maiaCurveSource = useMaiaCurveSource(review, isRunning, gameId);
  const { panelMove, panelParentId, variationAnchor, moveContext, goToLine } = useReviewPanelAnchor(
    { moveTree, selectedNodeId, moves, reviewByNodeId, selectNode }
  );
  const commentaryByNodeId = useMemo(() => {
    const commentary = new Map(
      (isRunning ? [] : (review?.commentary ?? [])).map((item) => [item.ply, item])
    );
    return new Map(
      moves.flatMap((move) => {
        const item = commentary.get(move.ply);
        return item ? [[move.nodeId, item] as const] : [];
      })
    );
  }, [review?.commentary, isRunning, moves]);
  // Review as: the side the game is reviewed for (asked before an imported game's first review).
  const reviewSide = useReviewSide(settings.reviewPlayerColor);
  const side = reviewSideColor(reviewSide);
  const sideKnown = reviewSide.status === "known";
  // The board starts on the reviewed side (turning it by hand stays until the side changes).
  useEffect(() => {
    if (sideKnown) useGameStore.getState().setOrientation(side);
  }, [board, side, sideKnown]);
  // Stats describe the finished review; while the pass runs they hold "—" instead of
  // re-computing (and re-flowing) on every analysed move.
  const statMoves = isRunning ? EMPTY_MOVES : moves;
  // The focused review: the reviewed side's few strongest lessons (the key insights).
  const moments = useMemo(
    () => keyMoments(statMoves.filter((move) => moverOf(move) === side)),
    [side, statMoves]
  );
  const momentIds = useMemo(() => new Set(moments.map((moment) => moment.nodeId)), [moments]);
  const { mutate: updateSetting } = useUpdateSettingMutation();
  const turnOnCommentary = useCallback(
    () => updateSetting({ key: "reviewCommentaryEnabled", value: true }),
    [updateSetting]
  );
  // The rating the shown review was made for (an older one: what a review now would use).
  const currentRating = useReviewRating(settings, side);
  const shownRating = review?.rating ?? currentRating;
  // The engine whose evaluations are shown (unknown while a run replaces the shown review).
  const shownEngine = reviewEngineName(isRunning ? null : review);
  const userRating = shownRating.rating;
  const commentaryOptions = {
    detail: settings.reviewCommentaryDetail,
    userRating,
    playerColor: side,
    settingsReady
  };
  const selected = useGameReviewCommentary({
    ...commentaryOptions,
    enabled: settings.reviewCommentaryEnabled,
    move: panelMove,
    visible: activeTab === "commentary"
  });
  const cardCommentary = useCardCommentaryOptions(
    settings.reviewCommentaryEnabled,
    commentaryOptions
  );

  const players = reviewPlayers(headers);
  const onMainline =
    selectedNodeId === "root" || reviewInput.some((move) => move.nodeId === selectedNodeId);
  /** No main-line moves (and no saved review): nothing to analyse or explain. */
  const emptyGame = reviewInput.length === 0 && !hasMoves;
  // Between the tab bar and the content, on every tab: a stopped or failed run, an analysis the
  // moves outgrew or whose marks were worked out again.
  const notices = useReviewNotices(reviewInput.length, onAnalyze);

  const changeSide = useCallback((next: "white" | "black") => chooseReviewSide(next), []);
  // The review settings dialog (the tab bar's gear opens it): the side and its rating are in it.
  const settingsDialog = (
    <ReviewSettingsDialog
      settings={settings}
      reviewSide={{
        side,
        whiteName: players.white.name,
        blackName: players.black.name,
        ratingLabel: reviewRatingLabel(shownRating),
        onChange: changeSide
      }}
    />
  );
  // Key moments come from the finished review only (none while one runs, none without moves), so
  // the review button shows only once there is one.
  const stepper = useReviewStepper({
    moments,
    session: { gameId, review, side },
    selectNode,
    onTabChange
  });

  // The game against the user's repertoire, in the summary's OPENING section: compared as the side
  // picked there, else the side reviewed.
  const repertoireColor = openingColor ?? side;
  const repertoireView = {
    headline: (
      <RepertoireHeadline
        moveTree={moveTree}
        color={repertoireColor}
        remembered={rememberedRepertoires}
        className="text-[12.5px] text-fg-muted"
      />
    ),
    panel: (
      <ReviewOpeningPanel
        moveTree={moveTree}
        selectedNodeId={selectedNodeId}
        onSelectNode={selectNode}
        color={repertoireColor}
        onColorChange={changeOpeningColor}
        remembered={rememberedRepertoires}
        onStudy={onOpenRepertoireStudy}
        onRefreshDecision={onRefreshRepertoireDecision}
        onHub={onRepertoireHub}
      />
    )
  };
  // One panel per tab; only the active one renders.
  const tabPanels: Record<ReviewTab, ReactNode> = {
    summary: (
      <ReviewSummaryTab
        running={isRunning}
        hasReview={hasMoves}
        summary={
          <ReviewSummary
            moves={moves}
            mainline={reviewInput}
            opening={review?.opening}
            side={side}
            moments={moments}
            onSelectNode={selectNode}
            repertoire={repertoireView}
            onOpenPuzzles={onOpenPuzzles}
            onAddCommentaryKey={onOpenCommentarySettings}
          />
        }
        reviewSide={reviewSide}
        players={players}
        onAnalyze={onAnalyze}
      />
    ),
    commentary: (
      <ReviewCommentaryPanel
        move={panelMove}
        hasReview={hasMoves}
        running={isRunning}
        status={selected.status}
        commentary={selected.commentary}
        model={selected.model}
        error={selected.error}
        detail={settings.reviewCommentaryDetail}
        userRating={userRating}
        onRetry={selected.retry}
        rewrite={selected.rewrite}
        onAnalyze={onAnalyze}
        onOpenCommentarySettings={onOpenCommentarySettings}
        onTurnOnCommentary={turnOnCommentary}
        moveContext={moveContext}
        onGoToLine={goToLine}
        variationAnchor={variationAnchor}
      />
    ),
    moves: (
      <ReviewMoveRail
        nodes={moveTree}
        selectedNodeId={selectedNodeId}
        reviews={reviewByNodeId}
        commentaryByNodeId={commentaryByNodeId}
        onSelectNode={selectNode}
        opening={shown.opening}
        orientation={orientation}
      />
    ),
    engine: (
      <ReviewEnginePanel
        move={panelMove}
        hasReview={hasMoves}
        running={isRunning}
        showTopLines={settings.reviewShowTopLines}
        userRating={userRating}
        reviewedSide={side}
        evalEngine={shownEngine}
        maiaCurveSource={maiaCurveSource}
        onAnalyze={onAnalyze}
        moves={moves}
        parentNodeId={panelParentId}
        onGoToLine={goToLine}
        variationAnchor={variationAnchor}
      />
    )
  };
  const panelId = useId();
  return (
    <CardCommentaryContext.Provider value={cardCommentary}>
      <BoardWorkspace
        tabPanel={tabPanelProps(panelId, activeTab)}
        panelLabel="Review"
        board={<ReviewBoardStage moves={moves} selectedMove={reviewByNodeId.get(selectedNodeId)} />}
        tabBar={
          <ReviewTabBar
            panelId={panelId}
            tab={activeTab}
            onChange={onTabChange}
            onExportPgn={onExportPgn}
          />
        }
        flushBody
        notices={<ReviewNotices notices={notices} onAnalyze={onAnalyze} />}
        footer={
          <>
            {hasMoves || isRunning ? (
              <div className="border-b border-line-subtle px-3 pb-1">
                {/* Its top edge is the charts' splitter, against the panel content above. */}
                <ReviewCharts
                  moves={moves}
                  variationSelected={!onMainline}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectNode}
                  reviewedSide={side}
                  evalEngine={shownEngine}
                  keyMomentIds={momentIds}
                  mainline={reviewInput}
                  timeControl={headers.timeControl}
                  {...chartsReview(review, isRunning, reviewInput.length, userRating)}
                />
              </div>
            ) : null}
            <ReviewNavigationRow
              step={stepper.step}
              onStep={stepper.stepThrough}
              hasReview={hasMoves}
              running={isRunning}
              fallbackTotal={reviewInput.length}
              follow={follow}
            />
          </>
        }
      >
        {/* The tab's content keeps the panel's padding (the notices above span its full width). */}
        <div className="h-full p-3">
          {emptyGame && activeTab !== "moves" ? (
            <NothingToReview onImportPgn={onImportPgn} onPlay={onPlay} />
          ) : (
            tabPanels[activeTab]
          )}
        </div>
      </BoardWorkspace>
      {settingsDialog}
    </CardCommentaryContext.Provider>
  );
}

const REVIEW_SETTINGS_ICON = <Settings />;
const ExportIcon = DESTINATION_ICONS.exportPgn;
const EXPORT_ICON = <ExportIcon />;

/**
 * The panel's title bar: Summary · Commentary · Moves (the game's length) · Engine, then Export
 * PGN (the game with its analysis, as on Analyze) and the review settings, last.
 */
const ReviewTabBar = memo(function ReviewTabBar({
  panelId,
  tab,
  onChange,
  onExportPgn
}: {
  panelId: string;
  tab: ReviewTab;
  onChange: (tab: ReviewTab) => void;
  onExportPgn: () => void;
}) {
  const moveCount = useMainlineMoveCount();
  const tabs: WorkspaceTab<ReviewTab>[] = [
    { value: "summary", label: "Summary" },
    { value: "commentary", label: "Commentary" },
    { value: "moves", label: "Moves", count: moveCount },
    { value: "engine", label: "Engine" }
  ];
  return (
    <WorkspaceTabBar
      panelId={panelId}
      ariaLabel="Game review sections"
      fitNarrow
      tabs={tabs}
      value={tab}
      onChange={onChange}
      actions={
        <>
          <IconButton
            label="Export PGN with analysis"
            icon={EXPORT_ICON}
            size="icon-xs"
            disabled={!window.chaturanga}
            onClick={onExportPgn}
          />
          <IconButton
            label="Review settings"
            icon={REVIEW_SETTINGS_ICON}
            size="icon-xs"
            onClick={openReviewSettingsDialog}
          />
        </>
      }
    />
  );
});

const EMPTY_MOVES: MoveReview[] = [];

/**
 * Where a move's rating curve is read from: a finished Maia 3 review (null otherwise). Main reads
 * it once the autosave has written the review, moments after it finishes; until then the curve
 * query asks again (queries/maia.ts).
 */
function useMaiaCurveSource(review: GameReview | null, running: boolean, gameId: string | null) {
  const savedReviewId = !running && review?.maia?.model === "maia3" ? review.reviewId : undefined;
  return useMemo(
    () => (gameId && savedReviewId ? { gameId, reviewId: savedReviewId } : null),
    [gameId, savedReviewId]
  );
}

/** The analysis shown (a running review's, as it comes in). */
function useShownReview() {
  const review = useReviewStore((state) => state.review);
  const moves = useDisplayedReviewMoves();
  return {
    review,
    moves,
    running: useReviewStore((state) => state.status === "running"),
    hasMoves: moves.length > 0,
    // The move list's opening row: a running review's too, as soon as its moves name the opening.
    opening: useReviewStore(selectDisplayedOpening)
  };
}

/**
 * Key-insight cards expand to the same commentary as the Commentary tab while AI commentary is on
 * (and an OpenRouter key is saved); null otherwise.
 */
function useCardCommentaryOptions(
  enabled: boolean,
  { detail, userRating, playerColor, settingsReady }: CardCommentaryOptions
): CardCommentaryOptions | null {
  const openRouter = useOpenRouterConfigQuery();
  const aiOn = enabled && Boolean(openRouter.data?.hasApiKey);
  return useMemo(
    () => (aiOn ? { detail, userRating, playerColor, settingsReady } : null),
    [aiOn, detail, settingsReady, playerColor, userRating]
  );
}

/**
 * What the charts take from the review shown. A running review is drawn against the main line's
 * length, with no opening or Maia model yet (its Maia probabilities are real: it is new).
 */
function chartsReview(
  review: GameReview | null,
  running: boolean,
  mainlinePlies: number,
  rating: number
) {
  if (running)
    return {
      totalPlies: mainlinePlies,
      opening: undefined,
      maia: { model: null, rating, trusted: true }
    };
  return {
    totalPlies: undefined,
    opening: review?.opening,
    maia: {
      model: review?.rating?.maiaModel ?? null,
      rating,
      // Reviews before schema 2 stored made-up Maia probabilities.
      trusted: (review?.schemaVersion ?? 0) >= 2
    }
  };
}

/**
 * A game without moves: every tab but the move list says so, with Play (the main way to get one)
 * and Import PGN beside it.
 */
function NothingToReview({ onImportPgn, onPlay }: { onImportPgn: () => void; onPlay: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Sparkles />}
        title="Nothing to review yet"
        description="This game has no moves."
        action={
          <div className="flex justify-center gap-2">
            <Button variant="primary" size="sm" className="w-44" onClick={onPlay}>
              <Swords />
              Play
            </Button>
            <IconButton
              label="Import PGN"
              icon={<Upload />}
              variant="outline"
              onClick={onImportPgn}
            />
          </div>
        }
      />
    </div>
  );
}
