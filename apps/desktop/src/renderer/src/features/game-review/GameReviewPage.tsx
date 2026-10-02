import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import { reviewsByNode, useReviewStore } from "../../stores/review-store";
import { useDisplayedReviewMoves, useOutdatedReviewMoves } from "../../stores/review-validity";
import {
  averageLoss,
  countByClassification,
  mainlineReviewInput,
  moveLabel,
  reviewAccuracy,
  reviewIdFromPath,
  uciSquares,
  type ReviewTab
} from "./review-utils";
import { ReviewBoard, type ReviewArrow } from "./ReviewBoard";
import { ReviewCommentaryPanel } from "./ReviewCommentaryPanel";
import { ReviewEnginePanel } from "./ReviewEnginePanel";
import { ReviewMoveRail } from "./ReviewMoveRail";
import { ReviewSettingsPanel } from "./ReviewSettingsPanel";
import { ReviewTape } from "./ReviewTape";
import { ErrorBoundary } from "@/components/error-boundary";
import { PlayerRow } from "../board/PlayerIdentity";
import { BoardStage, BoardWorkspace, workspaceTabsClass } from "../board/BoardWorkspace";
import { EvalBar } from "../board/EvalBar";
import { MoveNavigation } from "../board/MoveNavigation";
import { useGameReviewCommentary } from "./useGameReviewCommentary";
import { useStoreHintsOnLeave } from "../onboarding/Coachmark";
import { useUpdateSettingMutation } from "../../queries/api";
import { openSavedGame } from "../game/saved-game";
import { reviewAnchorFor, type CommentaryMoveContext, type MoveNavigationTarget } from "./commentary-moves";
import { qualityTone } from "@/lib/ui";
import { Sparkles, Swords, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl, tabPanelProps, type SegmentedOption } from "@/components/ui/segmented-control";
import { Stat, StatGroup } from "@/components/ui/stat";
import { useReviewUsage } from "../../app/useUsageTelemetry";

const reviewTabOptions: readonly SegmentedOption<ReviewTab>[] = [
  { value: "commentary", label: "Commentary" },
  { value: "moves", label: "Moves" },
  { value: "engine", label: "Engine" },
  { value: "settings", label: "Settings" }
];

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
  /** Opens Settings → Commentary (offered when no OpenRouter key is saved). */
  onOpenCommentarySettings?: () => void;
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
  onOpenCommentarySettings
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
    () => (panelMove ? moveTree.find((node) => node.id === panelMove.nodeId)?.parentId ?? null : null),
    [moveTree, panelMove]
  );
  const variationAnchor = useMemo(
    () => (anchor?.variation ? { label: moveLabel(anchor.move), onBack: () => selectNode(anchor.move.nodeId) } : null),
    [anchor, selectNode]
  );
  const moveContext = useMemo<CommentaryMoveContext | null>(
    () => (panelMove ? { move: panelMove, moves, moveTree } : null),
    [moveTree, moves, panelMove]
  );
  const panelNodeId = panelMove?.nodeId ?? null;
  const goToLine = useCallback((target: MoveNavigationTarget) => {
    setLinkOriginNodeId(panelNodeId);
    useGameStore.getState().goToLine(target.startNodeId, target.moves);
  }, [panelNodeId]);
  const commentaryMap = useMemo(
    () => new Map((isRunning ? [] : review?.commentary ?? []).map((item) => [item.ply, item])),
    [review?.commentary, isRunning]
  );
  const commentaryByNodeId = useMemo(
    () => new Map(moves.flatMap((move) => {
      const item = commentaryMap.get(move.ply);
      return item ? [[move.nodeId, item] as const] : [];
    })),
    [commentaryMap, moves]
  );
  // Stats describe the finished review; while the pass runs they hold "—" instead of
  // re-computing (and re-flowing) on every analysed move.
  const statMoves = isRunning ? EMPTY_MOVES : moves;
  const counts = useMemo(() => countByClassification(statMoves), [statMoves]);
  const accuracy = useMemo(() => reviewAccuracy(statMoves), [statMoves]);
  const average = useMemo(() => averageLoss(statMoves), [statMoves]);
  const { mutate: updateSetting } = useUpdateSettingMutation();
  const turnOnCommentary = useCallback(
    () => updateSetting({ key: "reviewCommentaryEnabled", value: true }),
    [updateSetting]
  );
  const openReviewSettings = useCallback(() => onTabChange("settings"), [onTabChange]);
  const selected = useGameReviewCommentary({
    enabled: settings.reviewCommentaryEnabled,
    detail: settings.reviewCommentaryDetail,
    userRating: settings.reviewPlayerRating,
    playerColor: settings.reviewPlayerColor,
    settingsReady,
    move: panelMove,
    visible: activeTab === "commentary"
  });

  useEffect(() => {
    if (!id || id === "current" || id === gameId) return;
    let cancelled = false;
    setLoadError(null);
    void window.chaturanga?.games.get(id).then((saved) => {
      if (!cancelled && saved) openSavedGame(saved);
    }).catch((error) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load this game.");
    });
    return () => { cancelled = true; };
  }, [id, gameId]);

  const arrows = useMemo<ReviewArrow[]>(() => {
    if (!selectedMove) return [];
    const result: ReviewArrow[] = [];
    const best = uciSquares(selectedMove.bestMove);
    if (best) result.push({ ...best, brush: "green" });
    const played = uciSquares(selectedMove.playedMove);
    if (played && played.orig !== best?.orig) result.push({ ...played, brush: selectedMove.classification === "best" || selectedMove.classification === "excellent" ? "blue" : "red" });
    return result;
  }, [selectedMove]);
  const lastMove = uciSquares(selectedMove?.playedMove ?? currentNode?.uci ?? null);
  const whitePlayer = { name: headers.white || "White", elo: headers.whiteElo ?? null, color: "white" as const };
  const blackPlayer = { name: headers.black || "Black", elo: headers.blackElo ?? null, color: "black" as const };
  // The side at the bottom of the board is the orientation; its opponent sits on top.
  const boardTop = orientation === "white" ? blackPlayer : whitePlayer;
  const boardBottom = orientation === "white" ? whitePlayer : blackPlayer;
  const onMainline = selectedNodeId === "root" || reviewInput.some((move) => move.nodeId === selectedNodeId);
  const hasMoves = moves.length > 0;
  const hasStats = hasMoves && !isRunning;
  /** No main-line moves (and no saved review): nothing to analyse or explain. */
  const emptyGame = reviewInput.length === 0 && !hasMoves;

  // Memoised: stepping through moves leaves the review stats (and their Stat tree) alone.
  const summary = useMemo(
    () => (
      <StatGroup className="w-full">
        <Stat label="Accuracy" value={hasStats && accuracy !== null ? accuracy : "—"} />
        <Stat label="Avg loss" value={hasStats && average !== null ? `${average}cp` : "—"} mono />
        <Stat label="Errors" value={hasStats ? <ErrorCounts counts={counts} /> : "—"} />
      </StatGroup>
    ),
    [accuracy, average, counts, hasStats]
  );

  const panelId = useId();
  return (
    <BoardWorkspace
      tabPanel={tabPanelProps(panelId, activeTab)}
      panelLabel="Review"
      board={
        <BoardStage
          evalBar={<EvalBar orientation={orientation} />}
          top={<PlayerRow name={boardTop.name} elo={boardTop.elo} color={boardTop.color} />}
          bottom={<PlayerRow name={boardBottom.name} elo={boardBottom.elo} color={boardBottom.color} />}
        >
          <ReviewBoard fen={boardFen} orientation={orientation} arrows={arrows} lastMove={lastMove ? [lastMove.orig, lastMove.dest] : undefined} className="h-full w-full" />
        </BoardStage>
      }
      tabs={
        <SegmentedControl
          ariaLabel="Game review sections"
          role="tablist"
          panelId={panelId}
          fullWidth
          className={workspaceTabsClass}
          value={activeTab}
          onChange={onTabChange}
          options={reviewTabOptions}
        />
      }
      summary={summary}
      notices={
        loadError || reviewError || outdatedMoves ? (
          <>
            {loadError ? <Notice tone="warn" className="shrink-0">{loadError}</Notice> : null}
            {reviewError ? <Notice tone="danger" className="shrink-0">{reviewError}</Notice> : null}
            {outdatedMoves ? (
              <Notice tone="warn" className="shrink-0">
                The moves changed after this analysis, so it no longer covers {outdatedMoves === 1 ? "1 move" : `${outdatedMoves} moves`}. Analyse the game again to update it.
              </Notice>
            ) : null}
          </>
        ) : null
      }
      footer={
        <>
          {(hasMoves || isRunning) && activeTab !== "settings" ? (
            <div className="border-b border-line-subtle px-3 pb-1 pt-2">
              <ReviewTape
                moves={moves}
                variationSelected={!onMainline}
                selectedNodeId={selectedNodeId}
                onSelectNode={selectNode}
                orientation={orientation}
                totalPlies={isRunning ? reviewInput.length : undefined}
              />
            </div>
          ) : null}
          <MoveNavigation caption={isRunning ? <ReviewProgressCaption fallbackTotal={reviewInput.length} /> : null} />
        </>
      }
    >
      {emptyGame && (activeTab === "commentary" || activeTab === "engine") ? (
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
          userRating={settings.reviewPlayerRating}
          onRetry={selected.retry}
          onAnalyze={onAnalyze}
          onOpenCommentarySettings={onOpenCommentarySettings}
          onOpenReviewSettings={openReviewSettings}
          onTurnOnCommentary={turnOnCommentary}
          moveContext={moveContext}
          onGoToLine={goToLine}
          variationAnchor={variationAnchor}
        />
      ) : null}
      {activeTab === "moves" ? <ReviewMoveRail nodes={moveTree} selectedNodeId={selectedNodeId} reviews={reviewByNodeId} commentaryByNodeId={commentaryByNodeId} onSelectNode={selectNode} /> : null}
      {activeTab === "engine" && !emptyGame ? (
        <ReviewEnginePanel
          move={panelMove}
          hasReview={hasMoves}
          running={isRunning}
          showTopLines={settings.reviewShowTopLines}
          userRating={settings.reviewPlayerRating}
          onAnalyze={onAnalyze}
          moves={moves}
          parentNodeId={panelParentId}
          onGoToLine={goToLine}
          variationAnchor={variationAnchor}
        />
      ) : null}
      {activeTab === "settings" ? <ReviewSettingsPanel settings={settings} onClose={() => onTabChange("commentary")} /> : null}
    </BoardWorkspace>
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
    <span className="inline-grid justify-items-center gap-1" role="status" aria-label={current ? `Analyzing move ${current} of ${total}` : "Starting analysis"}>
      <span>{current ? `Analyzing move ${current} of ${total}` : "Starting analysis…"}</span>
      <span className="block h-0.5 w-28 overflow-hidden rounded-full bg-control" aria-hidden>
        <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function ErrorCounts({ counts }: { counts: Record<string, number> }) {
  const items = [
    { key: "blunder", label: "blunders", glyph: "??" },
    { key: "mistake", label: "mistakes", glyph: "?" },
    { key: "inaccuracy", label: "inaccuracies", glyph: "?!" }
  ] as const;
  const summary = items.map((item) => `${counts[item.key] ?? 0} ${item.label}`).join(", ");
  return (
    <span className="inline-flex items-baseline gap-2" aria-label={summary} title={summary}>
      {items.map((item) => {
        const count = counts[item.key] ?? 0;
        return (
          <span key={item.key} className="inline-flex items-baseline">
            <span className={count ? qualityTone[item.key].text : "text-fg-subtle"}>{count}</span>
            <span className="text-2xs font-normal text-fg-subtle">{item.glyph}</span>
          </span>
        );
      })}
    </span>
  );
}
