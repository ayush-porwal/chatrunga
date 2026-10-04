import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { StudyOpenTarget } from "../repertoire/repertoire-chapters";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, useReviewStore } from "../../stores/review-store";
import { useDisplayedReviewMoves, useOutdatedReviewMoves } from "../../stores/review-validity";
import { boardClocksAt, sideToMove } from "../board/board-clocks";
import {
  mainlineReviewInput,
  moveLabel,
  reviewIdFromPath,
  uciSquares,
  type ReviewTab
} from "./review-utils";
import { ReviewBoard, type ReviewArrow } from "./ReviewBoard";
import { ReviewCommentaryPanel } from "./ReviewCommentaryPanel";
import { ReviewEnginePanel } from "./ReviewEnginePanel";
import { ReviewMoveRail } from "./ReviewMoveRail";
import { ReviewOpeningPanel } from "./ReviewOpeningPanel";
import { openReviewSettingsDialog, ReviewSettingsButton } from "./ReviewSettingsDialog";
import { ReviewSidePrompt, ReviewSummary } from "./ReviewSummary";
import { CardCommentaryContext, type CardCommentaryOptions } from "./MomentCommentary";
import { chooseReviewSide, reviewSideColor, useReviewSide } from "./review-side";
import { moverOf } from "./review-summary";
import { ReviewTape } from "./ReviewTape";
import { ErrorBoundary } from "@/components/error-boundary";
import { PlayerRow } from "../board/PlayerIdentity";
import { BoardStage, BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { EvalBar } from "../board/EvalBar";
import { BoardMoveMarkBadge } from "../board/BoardMoveMarkBadge";
import { boardMoveMark } from "../board/move-mark";
import { MoveNavigation } from "../board/MoveNavigation";
import { useGameReviewCommentary } from "./useGameReviewCommentary";
import { reviewRatingLabel, useReviewRating } from "./use-review-rating";
import { useStoreHintsOnLeave } from "../onboarding/Coachmark";
import { useOpenRouterConfigQuery, useUpdateSettingMutation } from "../../queries/api";
import { openSavedGame } from "../game/saved-game";
import {
  reviewAnchorFor,
  type CommentaryMoveContext,
  type MoveNavigationTarget
} from "./commentary-moves";
import { openingSideFor, type OpeningSide } from "./opening-comparison";
import { keyMoments } from "@chaturanga/shared/chess/key-moments";
import { KeyMomentNav } from "./KeyMoments";
import { Sparkles, Swords, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  SegmentedControl,
  tabPanelProps,
  type SegmentedOption
} from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { useReviewUsage } from "../../app/useUsageTelemetry";

const reviewTabOptions: readonly SegmentedOption<ReviewTab>[] = [
  { value: "summary", label: "Summary" },
  { value: "commentary", label: "Commentary" },
  { value: "moves", label: "Moves" },
  { value: "opening", label: "Opening" },
  { value: "engine", label: "Engine" }
];

/**
 * Five review tabs don't fit the workspace panel at its usual widths with the shared tab padding
 * and text size, so the labels truncated ("Comme…"): narrower panels tighten the padding, then the
 * text, so every label stays whole down to the panel's 20rem minimum.
 */
const reviewTabsClass = `${workspaceTabsClass} @max-[424px]/panel:[&>button]:px-1.5 @max-[384px]/panel:[&>button]:text-xs @max-[344px]/panel:[&>button]:px-0.5`;

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
  openingSide = null,
  onOpeningSideChange,
  onOpenPuzzles
}: GameReviewPageProps) {
  const location = useLocation();
  const id = reviewIdFromPath(location.pathname);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Narrow selectors: this page must not re-render for unrelated game-store changes.
  const gameId = useGameStore((state) => state.gameId);
  useStoreHintsOnLeave(gameId);
  useReviewUsage();
  const moveTree = useGameStore((state) => state.moveTree);
  const selectedNodeId = useGameStore((state) => state.currentNodeId);
  const boardFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const headers = useGameStore((state) => state.headers);
  const selectNode = useGameStore((state) => state.goToNode);
  const reviewStatus = useReviewStore((state) => state.status);
  const review = useReviewStore((state) => state.review);
  const moves = useDisplayedReviewMoves();
  // Moves of the shown analysis the game no longer has (deleted or replaced since): left out above.
  const outdatedMoves = useOutdatedReviewMoves();
  const reviewError = useReviewStore((state) => state.error);
  const reviewInput = useMemo(() => mainlineReviewInput(moveTree), [moveTree]);
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
  const isRunning = reviewStatus === "running";
  const reviewByNodeId = useMemo(() => reviewsByNode(moves), [moves]);
  const currentNode = moveTree.find((node) => node.id === selectedNodeId) ?? null;
  const selectedMove = reviewByNodeId.get(selectedNodeId) ?? null;
  // On an unreviewed variation, commentary and engine evidence stay on the nearest reviewed ancestor.
  // The move whose commentary / engine line a link was clicked from keeps the anchor on its lines.
  const [linkOriginNodeId, setLinkOriginNodeId] = useState<string | null>(null);
  const currentAnchor = useMemo(
    () => reviewAnchorFor(moveTree, selectedNodeId, reviewByNodeId, linkOriginNodeId),
    [linkOriginNodeId, moveTree, reviewByNodeId, selectedNodeId]
  );
  // The board, graph and move list follow the selection at once; the text panels (commentary with
  // its move links, engine evidence) follow as an interruptible low-priority render, so scrubbing
  // through moves never waits for them.
  const anchor = useDeferredValue(currentAnchor);
  const panelMove = anchor?.move ?? null;
  const panelParentId = useMemo(
    () =>
      panelMove ? (moveTree.find((node) => node.id === panelMove.nodeId)?.parentId ?? null) : null,
    [moveTree, panelMove]
  );
  const variationAnchor = useMemo(
    () =>
      anchor?.variation
        ? { label: moveLabel(anchor.move), onBack: () => selectNode(anchor.move.nodeId) }
        : null,
    [anchor, selectNode]
  );
  const moveContext = useMemo<CommentaryMoveContext | null>(
    () => (panelMove ? { move: panelMove, moves, moveTree } : null),
    [moveTree, moves, panelMove]
  );
  const panelNodeId = panelMove?.nodeId ?? null;
  const goToLine = useCallback(
    (target: MoveNavigationTarget) => {
      setLinkOriginNodeId(panelNodeId);
      useGameStore.getState().goToLine(target.startNodeId, target.moves);
    },
    [panelNodeId]
  );
  // A BEST line's move in the move list: its line from the error's parent, anchored on the error.
  const playBestLine = useCallback((target: MoveNavigationTarget, markedNodeId: string) => {
    setLinkOriginNodeId(markedNodeId);
    useGameStore.getState().goToLine(target.startNodeId, target.moves);
  }, []);
  const commentaryMap = useMemo(
    () => new Map((isRunning ? [] : (review?.commentary ?? [])).map((item) => [item.ply, item])),
    [review?.commentary, isRunning]
  );
  const commentaryByNodeId = useMemo(
    () =>
      new Map(
        moves.flatMap((move) => {
          const item = commentaryMap.get(move.ply);
          return item ? [[move.nodeId, item] as const] : [];
        })
      ),
    [commentaryMap, moves]
  );
  // Stats describe the finished review; while the pass runs they hold "—" instead of
  // re-computing (and re-flowing) on every analysed move.
  const statMoves = isRunning ? EMPTY_MOVES : moves;
  // Review as: the side the game is reviewed for (asked before an imported game's first review).
  const reviewSide = useReviewSide(settings.reviewPlayerColor);
  const side = reviewSideColor(reviewSide);
  const sideKnown = reviewSide.status === "known";
  // The board starts on the reviewed side (turning it by hand stays until the side changes).
  useEffect(() => {
    if (sideKnown) useGameStore.getState().setOrientation(side);
  }, [board, side, sideKnown]);
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
  const userRating = review?.rating?.rating ?? currentRating.rating;
  const selected = useGameReviewCommentary({
    enabled: settings.reviewCommentaryEnabled,
    detail: settings.reviewCommentaryDetail,
    userRating,
    playerColor: side,
    settingsReady,
    move: panelMove,
    visible: activeTab === "commentary"
  });
  // Key-insight cards expand to the same commentary while AI commentary is on (and keyed).
  const openRouter = useOpenRouterConfigQuery();
  const aiOn = settings.reviewCommentaryEnabled && Boolean(openRouter.data?.hasApiKey);
  const cardCommentary = useMemo<CardCommentaryOptions | null>(
    () =>
      aiOn
        ? {
            detail: settings.reviewCommentaryDetail,
            userRating,
            playerColor: side,
            settingsReady
          }
        : null,
    [aiOn, settings.reviewCommentaryDetail, settingsReady, side, userRating]
  );

  useEffect(() => {
    if (!id || id === "current" || id === gameId) return;
    let cancelled = false;
    setLoadError(null);
    void window.chaturanga?.games
      .get(id)
      .then((saved) => {
        if (!cancelled && saved) openSavedGame(saved);
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : "Could not load this game.");
      });
    return () => {
      cancelled = true;
    };
  }, [id, gameId]);

  const arrows = useMemo<ReviewArrow[]>(() => {
    if (!selectedMove) return [];
    const result: ReviewArrow[] = [];
    const best = uciSquares(selectedMove.bestMove);
    if (best) result.push({ ...best, brush: "green" });
    const played = uciSquares(selectedMove.playedMove);
    // Red for a move that cost something (any error, marked or not), blue otherwise.
    if (played && played.orig !== best?.orig)
      result.push({ ...played, brush: selectedMove.assessment?.severity ? "red" : "blue" });
    return result;
  }, [selectedMove]);
  const lastMove = uciSquares(selectedMove?.playedMove ?? currentNode?.uci ?? null);
  const moveMark = useMemo(
    () => boardMoveMark("review", { running: isRunning, moves, nodeId: selectedNodeId }),
    [isRunning, moves, selectedNodeId]
  );
  const whitePlayer = {
    name: headers.white || "White",
    elo: headers.whiteElo ?? null,
    color: "white" as const
  };
  const blackPlayer = {
    name: headers.black || "Black",
    elo: headers.blackElo ?? null,
    color: "black" as const
  };
  // The side at the bottom of the board is the orientation; its opponent sits on top.
  const boardTop = orientation === "white" ? blackPlayer : whitePlayer;
  const boardBottom = orientation === "white" ? whitePlayer : blackPlayer;
  // Each side's time left at the selected move, from the game's [%clk] (none without them).
  const clocks = useMemo(
    () => boardClocksAt(moveTree, selectedNodeId, headers.timeControl),
    [headers.timeControl, moveTree, selectedNodeId]
  );
  const toMove = sideToMove(boardFen);
  const onMainline =
    selectedNodeId === "root" || reviewInput.some((move) => move.nodeId === selectedNodeId);
  // Key-moment steps count from the selected move (a variation counts from the move it leaves).
  const selectedPly = currentAnchor?.move.ply ?? currentNode?.ply ?? 0;
  const momentNav = useMemo(
    () => <KeyMomentNav moments={moments} selectedPly={selectedPly} onSelectNode={selectNode} />,
    [moments, selectNode, selectedPly]
  );
  const recomputed = Boolean(review?.assessmentsRecomputed) && !isRunning;
  const hasMoves = moves.length > 0;
  /** No main-line moves (and no saved review): nothing to analyse or explain. */
  const emptyGame = reviewInput.length === 0 && !hasMoves;

  const changeSide = useCallback((next: "white" | "black") => chooseReviewSide(next), []);
  const ratingLabel = reviewRatingLabel(review?.rating ?? currentRating);
  // The panel's header row: the side reviewed and the rating it's rated at, and the settings.
  const summary = (
    <div className="flex w-full min-w-0 items-center gap-2">
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-muted">
        <SideDot color={side} />
        <span className="shrink-0 font-medium text-fg-secondary">
          {sideKnown ? `Review as ${side === "white" ? "White" : "Black"}` : "Review as…"}
        </span>
        {sideKnown ? (
          <span className="truncate text-fg-subtle" title={ratingLabel}>
            · {ratingLabel}
          </span>
        ) : null}
      </span>
      <ReviewSettingsButton
        settings={settings}
        reviewSide={{
          side,
          whiteName: whitePlayer.name,
          blackName: blackPlayer.name,
          onChange: changeSide
        }}
      />
    </div>
  );
  // Start review: the first key moment, explained, then Next steps through the rest.
  const startKeyMoments = useCallback(() => {
    const first = moments[0];
    if (!first) return;
    selectNode(first.nodeId);
    onTabChange("commentary");
  }, [moments, onTabChange, selectNode]);
  const startSideReview = useCallback(
    (picked: "white" | "black") => {
      chooseReviewSide(picked);
      onAnalyze?.();
    },
    [onAnalyze]
  );

  const panelId = useId();
  return (
    <CardCommentaryContext.Provider value={cardCommentary}>
      <BoardWorkspace
        tabPanel={tabPanelProps(panelId, activeTab)}
        panelLabel="Review"
        board={
          <BoardStage
            evalBar={<EvalBar orientation={orientation} />}
            top={
              <PlayerRow
                name={boardTop.name}
                elo={boardTop.elo}
                color={boardTop.color}
                clock={clocks?.[boardTop.color] ?? null}
                clockActive={toMove === boardTop.color}
              />
            }
            bottom={
              <PlayerRow
                name={boardBottom.name}
                elo={boardBottom.elo}
                color={boardBottom.color}
                clock={clocks?.[boardBottom.color] ?? null}
                clockActive={toMove === boardBottom.color}
              />
            }
          >
            {/* Its own stacking context: Chessground's layers and the move mark stack within the board. */}
            <div className="relative isolate h-full w-full">
              {/* Square corners: the stage's frame clips the board to its own radius. */}
              <ReviewBoard
                fen={boardFen}
                orientation={orientation}
                arrows={arrows}
                lastMove={lastMove ? [lastMove.orig, lastMove.dest] : undefined}
                className="h-full w-full rounded-none"
              />
              <BoardMoveMarkBadge mark={moveMark} orientation={orientation} />
            </div>
          </BoardStage>
        }
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
        summary={summary}
        notices={
          loadError || reviewError || outdatedMoves || recomputed ? (
            <>
              {loadError ? (
                <Notice tone="warn" className="shrink-0">
                  {loadError}
                </Notice>
              ) : null}
              {reviewError ? (
                <Notice tone="danger" className="shrink-0">
                  {reviewError}
                </Notice>
              ) : null}
              {recomputed ? (
                <Notice tone="info" className="shrink-0">
                  This analysis predates the current move marks, so they were worked out again from
                  its saved evaluations. Great and Brilliant need a deeper search: analyse the game
                  again to see them.
                </Notice>
              ) : null}
              {outdatedMoves ? (
                <Notice tone="warn" className="shrink-0">
                  The moves changed after this analysis, so it no longer covers{" "}
                  {outdatedMoves === 1 ? "1 move" : `${outdatedMoves} moves`}. Analyse the game
                  again to update it.
                </Notice>
              ) : null}
            </>
          ) : null
        }
        footer={
          <>
            {hasMoves || isRunning ? (
              <div className="border-b border-line-subtle px-3 pb-1 pt-2">
                <ReviewTape
                  moves={moves}
                  variationSelected={!onMainline}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectNode}
                  orientation={orientation}
                  totalPlies={isRunning ? reviewInput.length : undefined}
                  keyMomentIds={momentIds}
                  actions={momentNav}
                />
              </div>
            ) : null}
            <MoveNavigation
              caption={
                isRunning ? <ReviewProgressCaption fallbackTotal={reviewInput.length} /> : null
              }
            />
          </>
        }
      >
        {emptyGame &&
        (activeTab === "summary" || activeTab === "commentary" || activeTab === "engine") ? (
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
        ) : activeTab === "summary" ? (
          isRunning ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={<Sparkles />}
                title="Analyzing…"
                description="The summary is ready when the analysis finishes. Progress is shown below."
              />
            </div>
          ) : hasMoves ? (
            <ReviewSummary
              moves={moves}
              mainline={reviewInput}
              opening={review?.opening}
              side={side}
              hasKeyMoments={moments.length > 0}
              onStartReview={startKeyMoments}
              onOpenRepertoire={() => onTabChange("opening")}
              onOpenPuzzles={onOpenPuzzles}
            />
          ) : reviewSide.status === "ask" ? (
            <ReviewSidePrompt
              preselect={reviewSide.preselect}
              whiteName={whitePlayer.name}
              blackName={blackPlayer.name}
              onStart={onAnalyze ? startSideReview : undefined}
            />
          ) : (
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
          )
        ) : activeTab === "commentary" ? (
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
        ) : null}
        {activeTab === "moves" ? (
          <ReviewMoveRail
            nodes={moveTree}
            selectedNodeId={selectedNodeId}
            reviews={reviewByNodeId}
            commentaryByNodeId={commentaryByNodeId}
            onSelectNode={selectNode}
            moves={moves}
            keyMoments={moments}
            opening={isRunning ? null : review?.opening}
            onPlayLine={playBestLine}
            orientation={orientation}
          />
        ) : null}
        {activeTab === "opening" ? (
          <ReviewOpeningPanel
            moveTree={moveTree}
            selectedNodeId={selectedNodeId}
            onSelectNode={selectNode}
            color={openingColor}
            onColorChange={changeOpeningColor}
            remembered={rememberedRepertoires}
            onStudy={onOpenRepertoireStudy}
            onRefreshDecision={onRefreshRepertoireDecision}
            onHub={onRepertoireHub}
          />
        ) : null}
        {activeTab === "engine" && !emptyGame ? (
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
        ) : null}
      </BoardWorkspace>
    </CardCommentaryContext.Provider>
  );
}

const EMPTY_MOVES: MoveReview[] = [];

/**
 * The single place review progress is shown. It subscribes to the progress step itself so a
 * tick re-renders only this caption, not the page, graph or panel.
 */
function ReviewProgressCaption({ fallbackTotal }: { fallbackTotal: number }) {
  const moveIndex = useReviewStore((state) => state.progress?.moveIndex ?? null);
  const totalMoves = useReviewStore((state) => state.progress?.totalMoves ?? null);
  const total = totalMoves ?? fallbackTotal;
  const current = moveIndex === null ? 0 : Math.min(moveIndex + 1, total);
  const percent = total ? Math.round((Math.max(current - 1, 0) / total) * 100) : 0;
  return (
    <span
      className="inline-grid justify-items-center gap-1"
      role="status"
      aria-label={current ? `Analyzing move ${current} of ${total}` : "Starting analysis"}
    >
      <span>{current ? `Analyzing move ${current} of ${total}` : "Starting analysis…"}</span>
      <span className="block h-0.5 w-28 overflow-hidden rounded-full bg-control" aria-hidden>
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}
