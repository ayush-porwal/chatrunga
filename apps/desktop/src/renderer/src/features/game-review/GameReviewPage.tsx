import { memo, useCallback, useEffect, useId, useMemo, type ReactNode } from "react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { GameReview, MoveReview } from "@chaturanga/shared/types/engine";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { StudyOpenTarget } from "../repertoire/repertoire-chapters";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, selectDisplayedOpening, useReviewStore } from "../../stores/review-store";
import { useDisplayedReviewMoves, useOutdatedReviewMoves } from "../../stores/review-validity";
import { mainlineReviewInput, type ReviewTab } from "./review-utils";
import { ReviewBoardStage, reviewPlayers } from "./ReviewBoardStage";
import { ReviewCommentaryPanel } from "./ReviewCommentaryPanel";
import { ReviewEnginePanel } from "./ReviewEnginePanel";
import { ReviewMoveRail } from "./ReviewMoveRail";
import { RepertoireHeadline, ReviewOpeningPanel } from "./ReviewOpeningPanel";
import { openReviewSettingsDialog, ReviewSettingsDialog } from "./ReviewSettingsDialog";
import { ReviewSidePrompt, ReviewSummary } from "./ReviewSummary";
import { CardCommentaryContext, type CardCommentaryOptions } from "./MomentCommentary";
import { chooseReviewSide, reviewSideColor, useReviewSide, type ReviewSide } from "./review-side";
import { moverOf } from "./review-summary";
import { ReviewCharts } from "./ReviewCharts";
import { useAnalysisFollow } from "./useAnalysisFollow";
import type { ReviewStepAction } from "./review-steps";
import { useReviewPanelAnchor } from "./useReviewPanelAnchor";
import { useReviewStepper } from "./useReviewStepper";
import { ErrorBoundary } from "@/components/error-boundary";
import { cn } from "@/lib/utils";
import { BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { MoveNavigation } from "../board/MoveNavigation";
import { blackToMove, fullMoveCount } from "../board/move-counter";
import { useGameReviewCommentary } from "./useGameReviewCommentary";
import { reviewRatingLabel, useReviewRating } from "./use-review-rating";
import { useStoreHintsOnLeave } from "../onboarding/Coachmark";
import { useOpenRouterConfigQuery, useUpdateSettingMutation } from "../../queries/api";
import { useCollapsible } from "@/components/ui/collapsible-section";
import { ReviewPanelHeader } from "./ReviewPanelHeader";
import { openingSideFor, type OpeningSide } from "./opening-comparison";
import { keyMoments } from "@chaturanga/shared/chess/key-moments";
import { Sparkles, Swords, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  SegmentedControl,
  tabPanelProps,
  type SegmentedOption
} from "@/components/ui/segmented-control";
import { useReviewUsage } from "../../app/useUsageTelemetry";

const reviewTabOptions: readonly SegmentedOption<ReviewTab>[] = [
  { value: "summary", label: "Summary" },
  { value: "commentary", label: "Commentary" },
  { value: "moves", label: "Moves" },
  { value: "engine", label: "Engine" }
];

/**
 * The five review tabs share the row's full width and never truncate a label: narrower panels
 * tighten the padding, then the text, so every label stays whole down to the panel's 20rem
 * minimum; narrower than that (or with larger text), the row scrolls sideways instead, the
 * selected tab kept in view.
 */
const reviewTabsClass = `${workspaceTabsClass} overflow-x-auto [scrollbar-width:none] [&>button]:shrink-0 [&>button>span]:overflow-visible @max-[424px]/panel:[&>button]:px-1.5 @max-[384px]/panel:[&>button]:text-xs @max-[344px]/panel:[&>button]:px-0.5`;

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
  const openReviewSettings = useCallback(() => openReviewSettingsDialog(), []);
  // The rating the shown review was made for (an older one: what a review now would use).
  const currentRating = useReviewRating(settings, side);
  const shownRating = review?.rating ?? currentRating;
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

  const changeSide = useCallback((next: "white" | "black") => chooseReviewSide(next), []);
  // The review settings dialog (the titlebar's gear opens it): the side and its rating are in it.
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

  // The "Review" section (tabs and content) folds under its header; the charts take the space.
  const reviewSection = useCollapsible("review-panel:review");
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
            repertoire={repertoireView}
            onOpenPuzzles={onOpenPuzzles}
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
        onOpenReviewSettings={openReviewSettings}
        onTurnOnCommentary={turnOnCommentary}
        moveContext={moveContext}
        onGoToLine={goToLine}
        variationAnchor={variationAnchor}
        keyMoments={moments}
        reviewMoves={moves}
        onSelectNode={selectNode}
      />
    ),
    moves: (
      <ReviewMoveRail
        nodes={moveTree}
        selectedNodeId={selectedNodeId}
        reviews={reviewByNodeId}
        commentaryByNodeId={commentaryByNodeId}
        onSelectNode={selectNode}
        moves={moves}
        keyMoments={moments}
        opening={shown.opening}
        runId={shown.runId}
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
        header={<ReviewPanelHeader section={reviewSection} />}
        bodyCollapsed={!reviewSection.open}
        bodyId={reviewSection.contentId}
        panelLabel="Review"
        board={<ReviewBoardStage moves={moves} selectedMove={reviewByNodeId.get(selectedNodeId)} />}
        tabs={
          <SegmentedControl
            ariaLabel="Game review sections"
            role="tablist"
            panelId={panelId}
            fullWidth
            className={reviewTabsClass}
            value={activeTab}
            onChange={onTabChange}
            options={reviewTabOptions}
          />
        }
        notices={
          <ReviewNotices
            error={shown.error}
            recomputed={shown.recomputed}
            outdatedMoves={shown.outdatedMoves}
          />
        }
        footer={
          <>
            {hasMoves || isRunning ? (
              <div
                className={cn(
                  "border-b border-line-subtle px-3 pb-1",
                  // Review folded: the charts take the panel's height down to the navigation.
                  !reviewSection.open && "flex min-h-0 flex-1 flex-col"
                )}
              >
                {/* Its top edge is the charts' splitter, against the panel content above. */}
                <ReviewCharts
                  fill={!reviewSection.open}
                  moves={moves}
                  variationSelected={!onMainline}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectNode}
                  reviewedSide={side}
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
              running={isRunning}
              fallbackTotal={reviewInput.length}
              follow={follow}
            />
          </>
        }
      >
        {emptyGame && activeTab !== "moves" ? (
          <NothingToReview onImportPgn={onImportPgn} onPlay={onPlay} />
        ) : (
          tabPanels[activeTab]
        )}
      </BoardWorkspace>
      {settingsDialog}
    </CardCommentaryContext.Provider>
  );
}

const EMPTY_MOVES: MoveReview[] = [];

/** The analysis shown (a running review's, as it comes in) and what the panel says about it. */
function useShownReview() {
  const status = useReviewStore((state) => state.status);
  const review = useReviewStore((state) => state.review);
  const moves = useDisplayedReviewMoves();
  const running = status === "running";
  return {
    review,
    moves,
    running,
    hasMoves: moves.length > 0,
    error: useReviewStore((state) => state.error),
    // Moves of the shown analysis the game no longer has (deleted or replaced since): left out of
    // `moves`.
    outdatedMoves: useOutdatedReviewMoves(),
    recomputed: Boolean(review?.assessmentsRecomputed) && !running,
    // The move list's opening row: a running review's too, as soon as its moves name the opening.
    opening: useReviewStore(selectDisplayedOpening),
    runId: useReviewStore((state) => (state.status === "running" ? state.reviewId : null))
  };
}

type AnalysisFollow = ReturnType<typeof useAnalysisFollow>;

/**
 * The footer's last row: with the panel folded it's pinned to the bottom, the review button just
 * above the move navigation (captioned with a running review's progress).
 */
function ReviewNavigationRow({
  step,
  onStep,
  running,
  fallbackTotal,
  follow
}: {
  step: ReviewStepAction | null;
  onStep: () => void;
  running: boolean;
  /** The progress's total until the review reports its own: the main line's moves. */
  fallbackTotal: number;
  follow: AnalysisFollow;
}) {
  return (
    <div>
      {step ? (
        // Always here, on every tab, whatever is folded: the key moments, one by one.
        <div className="px-3 pt-2">
          <Button
            type="button"
            className="h-9 w-full border-transparent bg-accent-strong text-sm font-semibold text-fg hover:bg-accent-strong/85"
            onClick={onStep}
          >
            {step.label}
          </Button>
        </div>
      ) : null}
      <MoveNavigation
        caption={
          running ? (
            <ReviewProgressCaption
              fallbackTotal={fallbackTotal}
              onFollow={follow.paused ? follow.resume : undefined}
            />
          ) : null
        }
      />
    </div>
  );
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

/** The panel's notices: a failed review, re-derived move marks, and moves the analysis misses. */
function ReviewNotices({
  error,
  recomputed,
  outdatedMoves
}: {
  error: string | null;
  recomputed: boolean;
  outdatedMoves: number;
}) {
  return (
    <>
      {error ? (
        <Notice tone="danger" className="shrink-0">
          {error}
        </Notice>
      ) : null}
      {recomputed ? (
        <Notice tone="info" className="shrink-0">
          This analysis predates the current move marks, so they were worked out again from its
          saved evaluations. Great and Brilliant need a deeper search: analyse the game again to see
          them.
        </Notice>
      ) : null}
      {outdatedMoves ? (
        <Notice tone="warn" className="shrink-0">
          The moves changed after this analysis, so it no longer covers{" "}
          {outdatedMoves === 1 ? "1 move" : `${outdatedMoves} moves`}. Analyse the game again to
          update it.
        </Notice>
      ) : null}
    </>
  );
}

/** A game without moves: every tab but the move list offers a game to review instead. */
function NothingToReview({ onImportPgn, onPlay }: { onImportPgn: () => void; onPlay: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Sparkles />}
        title="Nothing to review yet"
        description="This game has no moves. Import a PGN or play a game, then review it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" size="sm" onClick={onImportPgn}>
              <Upload />
              Import PGN
            </Button>
            <Button variant="outline" size="sm" onClick={onPlay}>
              <Swords />
              Play
            </Button>
          </div>
        }
      />
    </div>
  );
}

/**
 * The Summary tab: the finished review's `summary`; while one runs, a wait; without one, the side
 * to review the game for (asked first) or the way to analyse it.
 */
function ReviewSummaryTab({
  running,
  hasReview,
  summary,
  reviewSide,
  players,
  onAnalyze
}: {
  running: boolean;
  hasReview: boolean;
  summary: ReactNode;
  reviewSide: ReviewSide;
  players: ReturnType<typeof reviewPlayers>;
  onAnalyze?: () => void;
}) {
  const startSideReview = useCallback(
    (picked: "white" | "black") => {
      chooseReviewSide(picked);
      onAnalyze?.();
    },
    [onAnalyze]
  );
  if (running)
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<Sparkles />}
          title="Analyzing…"
          description="The summary is ready when the analysis finishes. Progress is shown below."
        />
      </div>
    );
  if (hasReview) return summary;
  if (reviewSide.status === "ask")
    return (
      <ReviewSidePrompt
        preselect={reviewSide.preselect}
        whiteName={players.white.name}
        blackName={players.black.name}
        onStart={onAnalyze ? startSideReview : undefined}
      />
    );
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Sparkles />}
        title="No review yet"
        description="Analyze the game to see each side's accuracy, marks and key insights."
        action={
          onAnalyze ? (
            <Button variant="primary" size="sm" onClick={onAnalyze}>
              Analyze
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * The single place review progress is shown. It subscribes to the progress step itself so a
 * tick re-renders only this caption, not the page, graph or panel.
 */
function ReviewProgressCaption({
  fallbackTotal,
  onFollow
}: {
  fallbackTotal: number;
  /** Following the analysis is paused: offered to resume it. */
  onFollow?: () => void;
}) {
  const moveIndex = useReviewStore((state) => state.progress?.moveIndex ?? null);
  const totalMoves = useReviewStore((state) => state.progress?.totalMoves ?? null);
  const blackFirst = useGameStore((state) =>
    blackToMove(state.moveTree.find((node) => !node.parentId)?.fenBefore)
  );
  const total = totalMoves ?? fallbackTotal;
  const current = moveIndex === null ? 0 : Math.min(moveIndex + 1, total);
  const percent = total ? Math.round((Math.max(current - 1, 0) / total) * 100) : 0;
  // The progress is in plies; the caption counts full moves, as the move counter does.
  const progress = current
    ? `Analyzing move ${fullMoveCount(current, blackFirst)} of ${fullMoveCount(total, blackFirst)}`
    : null;
  return (
    <span className="inline-grid justify-items-center gap-0.5">
      <span role="status" aria-label={progress ?? "Starting analysis"}>
        {progress ?? "Starting analysis…"}
      </span>
      {/* One slot under the caption, so pausing never moves the panel: the progress bar, or the
          button that follows the analysis again. */}
      <span className="grid h-4 place-items-center">
        {onFollow ? (
          <button
            type="button"
            className="font-medium text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={onFollow}
          >
            Follow analysis
          </button>
        ) : (
          <span className="block h-0.5 w-28 overflow-hidden rounded-full bg-control" aria-hidden>
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </span>
    </span>
  );
}
